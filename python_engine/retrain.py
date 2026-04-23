"""
Weekly Retraining Script for Sortino/Upside Models
Runs via Task Scheduler (daily is fine — script checks if 7 days have passed).
Performs a full retrain from historical Dow 30 market data.
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore", message="Gym has been unmaintained")
warnings.filterwarnings("ignore", category=FutureWarning, module="yfinance")
try:
    from pandas.errors import Pandas4Warning
    warnings.filterwarnings("ignore", category=Pandas4Warning)
except ImportError:
    pass

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


def full_retrain(model_dir=None, strategies=None):
    """
    Full retrain from historical Dow 30 data.
    Downloads each ticker once and trains all requested strategies on the same data.

    Returns:
        dict mapping strategy name -> trained PPO model
    """
    if strategies is None:
        strategies = ["sortino"]
    if model_dir is None:
        model_dir = os.path.dirname(__file__)

    reward_fns = {s: get_reward_function(s) for s in strategies}
    Wrappers = {s: make_gymnasium_wrapper(reward_fns[s]) for s in strategies}
    models = {s: None for s in strategies}
    trained_counts = {s: 0 for s in strategies}

    print(f"Starting full retrain on historical data (strategies: {', '.join(strategies)})...")

    for i, ticker in enumerate(DOW_30):
        print(f"\n[{i+1}/{len(DOW_30)}] Processing {ticker}...")

        try:
            df = _download_yf_with_retries(ticker, start='2015-01-01', end='2024-01-01')
            df, err = sanitize_ohlcv(df)
            if err or len(df) < 100:
                print(f"Skipping {ticker}: insufficient data")
                continue

            for s in strategies:
                env = DummyVecEnv([lambda d=df, W=Wrappers[s]: W(d)])
                if models[s] is None:
                    print(f"  Initializing new PPO Agent ({s})...")
                    models[s] = PPO('MlpPolicy', env, verbose=0)
                else:
                    models[s].set_env(env)
                models[s].learn(total_timesteps=5000)
                trained_counts[s] += 1

        except Exception as e:
            print(f"Error training on {ticker}: {e}")
            continue

    for s in strategies:
        if models[s] is None:
            raise RuntimeError(
                f"No model could be trained for strategy '{s}': all {len(DOW_30)} tickers were skipped. "
                "Check network/SSL - add YFINANCE_INSECURE_SSL=1 to .env if you get certificate errors."
            )
        print(f"\nTrained {s} on {trained_counts[s]}/{len(DOW_30)} tickers.")

    return models


def should_retrain(strategies):
    """Check if 7+ days have passed since last full retrain for any of the given strategies."""
    conn = get_db_connection(NEON_DATABASE_URL)
    try:
        cur = conn.cursor()
        needs_retrain = False
        for strategy in strategies:
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

            if not row:
                print(f"No previous retrain found for {strategy}.")
                needs_retrain = True
                continue

            last_retrain = row[0]
            days_since = (time.time() - last_retrain.timestamp()) / 86400
            print(f"Last full retrain for {strategy} was {days_since:.1f} days ago.")
            if days_since >= 7:
                needs_retrain = True

        cur.close()
        return needs_retrain
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Weekly retrain for Dow30 RL model")
    parser.add_argument("--strategy", choices=["sortino", "upside", "both"], default="sortino",
                        help="Strategy to retrain: sortino, upside, or both")
    parser.add_argument("--force", action="store_true",
                        help="Force retrain even if less than 7 days since last")
    args = parser.parse_args()
    strategies = ["sortino", "upside"] if args.strategy == "both" else [args.strategy]

    print("=" * 60)
    print(f"Model Retraining Script (strategies={', '.join(strategies)})")
    print("=" * 60)

    if not args.force and not should_retrain(strategies):
        print("Not time for weekly retrain yet. Skipping.")
        return

    try:
        model_dir = os.path.dirname(__file__)
        models = full_retrain(model_dir=model_dir, strategies=strategies)

        all_ok = True
        for s, model in models.items():
            if model is None:
                print(f"\n[ERROR] No model to save for {s} (training failed for all tickers).")
                all_ok = False
                continue

            print(f"\nSaving model version (strategy={s}, training_type=full_retrain)...")
            version = save_model_version(
                model,
                NEON_DATABASE_URL,
                model_dir=model_dir,
                training_type="full_retrain",
                total_experiences=0,
                notes=f"Weekly retrain, strategy={s}",
                strategy=s
            )

            if version:
                print(f"[OK] {s} model version {version} saved and activated.")
            else:
                print(f"[ERROR] Error saving model version for {s}")
                all_ok = False

        if not all_ok:
            sys.exit(1)

        print(f"\n[OK] Retraining complete for: {', '.join(strategies)}")

    except Exception as e:
        print(f"\n[ERROR] Error during retraining: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
