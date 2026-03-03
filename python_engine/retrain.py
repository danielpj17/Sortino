"""
Weekly Retraining Script for Sortino/Upside Models
Runs via Task Scheduler (daily is fine — script checks if 7 days have passed).
Performs a full retrain from historical Dow 30 market data.
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore", message="Gym has been unmaintained")
warnings.filterwarnings("ignore", message="Timestamp.utcnow is deprecated")
warnings.filterwarnings("ignore", message=".*Timestamp.utcnow is deprecated.*", module=r"yfinance\.scrapers\.history")

import argparse
import time
import psycopg2
import pandas as pd
import yfinance as yf
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from gym_anytrading.envs import StocksEnv
import gymnasium as gym
from dotenv import load_dotenv
from model_manager import (
    get_latest_model, save_model_version,
    get_db_connection, get_reward_function
)

# Load environment variables
_load_dirs = [
    os.path.join(os.path.dirname(__file__), ".."),
    os.path.dirname(__file__),
]
for _d in _load_dirs:
    _e = os.path.join(_d, ".env")
    if os.path.isfile(_e):
        load_dotenv(_e)
        break
else:
    load_dotenv()

NEON_DATABASE_URL = os.getenv("DATABASE_URL")
if not NEON_DATABASE_URL:
    print("DATABASE_URL not set. Check .env.")
    sys.exit(1)

_yf_session = None
if os.getenv("YFINANCE_INSECURE_SSL", "").strip().lower() in ("1", "true", "yes"):
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    import requests
    _yf_session = requests.Session()
    _yf_session.verify = False

DOW_30 = [
    "AXP", "AMGN", "AAPL", "BA", "CAT", "CSCO", "CVX", "GS", "HD", "HON",
    "IBM", "INTC", "JNJ", "KO", "JPM", "MCD", "MMM", "MRK", "MSFT", "NKE",
    "PG", "TRV", "UNH", "CRM", "VZ", "V", "WMT", "DIS", "DOW",
]

REQUIRED_COLS = ["Open", "High", "Low", "Close", "Volume"]


def _download_yf_with_retries(ticker, max_attempts=3, **kwargs):
    """Download ticker data with retries for transient Yahoo/network errors."""
    if _yf_session is not None:
        kwargs["session"] = _yf_session
    kwargs.setdefault("progress", False)
    kwargs.setdefault("timeout", 30)
    kwargs.setdefault("threads", False)
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            data = yf.download(ticker, **kwargs)
            if data is not None and not data.empty:
                return data
        except Exception as e:
            last_err = e
        if attempt < max_attempts:
            time.sleep(2 * attempt)
    if last_err:
        print(f"Download failed for {ticker} after {max_attempts} attempts: {last_err}")
    return pd.DataFrame()


def make_gymnasium_wrapper(reward_fn):
    """Factory for GymnasiumWrapper with the given reward function."""
    class GymnasiumWrapper(gym.Env):
        def __init__(self, df):
            super().__init__()
            self.env = StocksEnv(df=df, window_size=10, frame_bound=(10, len(df)))
            self.action_space = self.env.action_space
            self.observation_space = self.env.observation_space

        def reset(self, seed=None, options=None):
            obs = self.env.reset()
            if isinstance(obs, tuple):
                obs = obs[0]
            return obs, {}

        def step(self, action):
            out = self.env.step(action)
            obs = out[0]
            raw_reward = float(out[1])
            terminated = out[2] if len(out) > 2 else False
            truncated = out[3] if len(out) > 3 else False
            info = out[4] if len(out) > 4 else {}
            reward = reward_fn(raw_reward)
            return obs, reward, terminated, truncated, info

        def render(self):
            return self.env.render()
    return GymnasiumWrapper


def sanitize_ohlcv(df):
    """Sanitize OHLCV data."""
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.loc[:, ~df.columns.duplicated()]
    df.dropna(inplace=True)
    missing = [c for c in REQUIRED_COLS if c not in df.columns]
    if missing:
        return None, missing
    df = df[REQUIRED_COLS].copy()
    for c in REQUIRED_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df.dropna(inplace=True)
    return df, None


def full_retrain(model_dir=None, strategy="sortino"):
    """
    Full retrain from historical Dow 30 data.

    Returns:
        Trained PPO model
    """
    if model_dir is None:
        model_dir = os.path.dirname(__file__)

    reward_fn = get_reward_function(strategy)
    GymnasiumWrapper = make_gymnasium_wrapper(reward_fn)

    print("Starting full retrain on historical data...")

    model = None
    trained_count = 0

    for i, ticker in enumerate(DOW_30):
        print(f"\n[{i+1}/{len(DOW_30)}] Processing {ticker}...")

        try:
            df = _download_yf_with_retries(ticker, start='2015-01-01', end='2024-01-01')
            df, err = sanitize_ohlcv(df)
            if err or len(df) < 100:
                print(f"Skipping {ticker}: insufficient data")
                continue

            env = DummyVecEnv([lambda d=df: GymnasiumWrapper(d)])

            if model is None:
                print("Initializing new PPO Agent...")
                model = PPO('MlpPolicy', env, verbose=0)
            else:
                model.set_env(env)

            model.learn(total_timesteps=5000)
            trained_count += 1

        except Exception as e:
            print(f"Error training on {ticker}: {e}")
            continue

    if model is None:
        raise RuntimeError(
            f"No model could be trained: all {len(DOW_30)} tickers were skipped. "
            "Check network/SSL - add YFINANCE_INSECURE_SSL=1 to .env if you get certificate errors."
        )

    print(f"\nTrained on {trained_count}/{len(DOW_30)} tickers.")
    return model


def should_retrain(strategy="sortino"):
    """Check if 7+ days have passed since last full retrain."""
    conn = get_db_connection(NEON_DATABASE_URL)
    try:
        cur = conn.cursor()
        try:
            cur.execute("""
                SELECT created_at
                FROM model_versions
                WHERE training_type = 'full_retrain' AND strategy = %s
                ORDER BY created_at DESC
                LIMIT 1
            """, (strategy,))
        except psycopg2.Error:
            cur.execute("""
                SELECT created_at
                FROM model_versions
                WHERE training_type = 'full_retrain'
                ORDER BY created_at DESC
                LIMIT 1
            """)
        row = cur.fetchone()
        cur.close()

        if not row:
            return True

        last_retrain = row[0]
        days_since = (time.time() - last_retrain.timestamp()) / 86400
        print(f"Last full retrain was {days_since:.1f} days ago.")
        return days_since >= 7
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Weekly retrain for Dow30 RL model")
    parser.add_argument("--strategy", choices=["sortino", "upside"], default="sortino",
                        help="Strategy to retrain: sortino or upside")
    parser.add_argument("--force", action="store_true",
                        help="Force retrain even if less than 7 days since last")
    args = parser.parse_args()
    strategy = args.strategy

    print("=" * 60)
    print(f"Model Retraining Script (strategy={strategy})")
    print("=" * 60)

    if not args.force and not should_retrain(strategy):
        print("Not time for weekly retrain yet. Skipping.")
        return

    try:
        model_dir = os.path.dirname(__file__)
        model = full_retrain(model_dir=model_dir, strategy=strategy)

        if model is None:
            print("\n[ERROR] No model to save (training failed for all tickers).")
            sys.exit(1)

        print(f"\nSaving model version (strategy={strategy}, training_type=full_retrain)...")
        version = save_model_version(
            model,
            NEON_DATABASE_URL,
            model_dir=model_dir,
            training_type="full_retrain",
            total_experiences=0,
            notes=f"Weekly retrain, strategy={strategy}",
            strategy=strategy
        )

        if version:
            print(f"\n[OK] Retraining complete! Model version {version} saved and activated.")
        else:
            print("\n[ERROR] Error saving model version")
            sys.exit(1)

    except Exception as e:
        print(f"\n[ERROR] Error during retraining: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
