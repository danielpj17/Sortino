"""
Daily Retraining Script for Sortino/Upside Models
Runs daily to update the model with new trading experiences using hybrid learning approach.
"""
import os
import sys
import argparse
import json
import time
import psycopg2
import numpy as np
import pandas as pd
import yfinance as yf
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from gym_anytrading.envs import StocksEnv
import gymnasium as gym
from dotenv import load_dotenv
from model_manager import (
    get_latest_model, save_model_version, get_model_performance,
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

# DOW 30 tickers
DOW_30 = [
    "AXP", "AMGN", "AAPL", "BA", "CAT", "CSCO", "CVX", "GS", "HD", "HON",
    "IBM", "INTC", "JNJ", "KO", "JPM", "MCD", "MMM", "MRK", "MSFT", "NKE",
    "PG", "TRV", "UNH", "CRM", "VZ", "V", "WMT", "DIS", "DOW",
]

REQUIRED_COLS = ["Open", "High", "Low", "Close", "Volume"]


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


def load_experiences_from_db(conn, limit=None):
    """
    Load training experiences from database.
    
    Args:
        conn: Database connection
        limit: Maximum number of experiences to load (None = all)
    
    Returns:
        List of experiences with observations, actions, and rewards
    """
    cur = conn.cursor()
    query = """
        SELECT id, ticker, observation, action, reward, is_completed, account_id
        FROM training_experiences
        WHERE is_completed = TRUE AND reward IS NOT NULL
        ORDER BY timestamp DESC
    """
    if limit:
        query += f" LIMIT {limit}"
    
    cur.execute(query)
    rows = cur.fetchall()
    cur.close()
    
    experiences = []
    for row in rows:
        exp_id, ticker, obs_json, action, reward, is_completed, account_id = row
        try:
            observation = json.loads(obs_json) if isinstance(obs_json, str) else obs_json
            experiences.append({
                'id': exp_id,
                'ticker': ticker,
                'observation': np.array(observation),
                'action': int(action),
                'reward': float(reward) if reward else 0.0,
                'account_id': account_id
            })
        except Exception as e:
            print(f"Error parsing experience {exp_id}: {e}")
            continue
    
    return experiences


def update_incomplete_experiences(conn, reward_fn):
    """
    Update rewards for experiences linked to completed trades.
    This handles cases where trades completed but experiences weren't updated.
    """
    cur = conn.cursor()
    
    # Find experiences with trades that have PNL calculated
    cur.execute("""
        SELECT 
            te.id as exp_id,
            t_buy.id as buy_trade_id,
            t_buy.price as buy_price,
            t_sell.id as sell_trade_id,
            t_sell.price as sell_price,
            t_buy.quantity
        FROM training_experiences te
        JOIN trades t_buy ON te.trade_id = t_buy.id
        LEFT JOIN trades t_sell ON t_buy.sell_trade_id = t_sell.id
        WHERE te.is_completed = FALSE 
        AND t_sell.id IS NOT NULL
        AND t_buy.pnl IS NOT NULL
    """)
    
    rows = cur.fetchall()
    updated = 0
    
    for row in rows:
        exp_id, buy_trade_id, buy_price, sell_trade_id, sell_price, quantity = row
        if buy_price and sell_price and quantity:
            # Calculate reward
            return_pct = (float(sell_price) - float(buy_price)) / float(buy_price)
            reward = reward_fn(return_pct)
            
            # Update experience
            cur.execute("""
                UPDATE training_experiences
                SET reward = %s, is_completed = TRUE
                WHERE id = %s
            """, (reward, exp_id))
            updated += 1
    
    conn.commit()
    cur.close()
    print(f"Updated {updated} incomplete experiences with rewards")
    return updated


def online_learning_update(model, conn, experiences, reward_fn, timesteps=1000):
    """
    Perform online learning update using new experiences.
    
    Args:
        model: Current PPO model
        conn: Database connection
        experiences: List of experiences to train on
        timesteps: Number of timesteps for training
    
    Returns:
        Updated model
    """
    if not experiences:
        print("No experiences available for online learning")
        return model
    
    GymnasiumWrapper = make_gymnasium_wrapper(reward_fn)
    
    print(f"Performing online learning update with {len(experiences)} experiences...")
    
    # Group experiences by ticker
    ticker_experiences = {}
    for exp in experiences:
        ticker = exp['ticker']
        if ticker not in ticker_experiences:
            ticker_experiences[ticker] = []
        ticker_experiences[ticker].append(exp)
    
    # Train on each ticker's experiences
    for ticker, ticker_exps in ticker_experiences.items():
        try:
            # Download recent data for this ticker
            data = yf.download(ticker, period="1mo", interval="1d", progress=False)
            df, err = sanitize_ohlcv(data)
            if err or len(df) < 15:
                continue
            
            df = df.reset_index(drop=True)
            
            # Create environment
            env = DummyVecEnv([lambda d=df: GymnasiumWrapper(d)])
            model.set_env(env)
            
            # Train for a few timesteps
            model.learn(total_timesteps=min(timesteps, len(ticker_exps) * 10))
            
        except Exception as e:
            print(f"Error training on {ticker}: {e}")
            continue
    
    return model


def full_retrain(db_url, model_dir=None, strategy="sortino"):
    """
    Perform full retraining from scratch using all historical data + experiences.
    
    Args:
        db_url: Database connection URL (fresh conn used after training to avoid timeout)
        model_dir: Directory to save model
        strategy: 'sortino' or 'upside'
    
    Returns:
        Trained model
    """
    if model_dir is None:
        model_dir = os.path.dirname(__file__)
    
    reward_fn = get_reward_function(strategy)
    GymnasiumWrapper = make_gymnasium_wrapper(reward_fn)
    
    print("Starting full retrain with historical data + live experiences...")
    
    model = None
    
    # Train on historical data (same as train.py)
    for i, ticker in enumerate(DOW_30):
        print(f"\n[{i+1}/{len(DOW_30)}] Processing {ticker}...")
        
        try:
            df = yf.download(ticker, start='2015-01-01', end='2024-01-01', progress=False)
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
            
        except Exception as e:
            print(f"Error training on {ticker}: {e}")
            continue
    
    # Load and incorporate live experiences (fresh conn - previous one may have timed out during long training)
    conn = get_db_connection(db_url)
    try:
        experiences = load_experiences_from_db(conn, limit=10000)  # Limit to prevent memory issues
        if experiences:
            print(f"Incorporating {len(experiences)} live trading experiences...")
            model = online_learning_update(model, conn, experiences, reward_fn, timesteps=2000)
    finally:
        conn.close()
    
    return model


def should_full_retrain(conn, strategy="sortino"):
    """
    Determine if we should do a full retrain (e.g., weekly).
    
    Returns:
        True if full retrain should be performed
    """
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT created_at, training_type
            FROM model_versions
            WHERE training_type = 'full_retrain' AND strategy = %s
            ORDER BY created_at DESC
            LIMIT 1
        """, (strategy,))
    except psycopg2.Error:
        # strategy column may not exist
        cur.execute("""
            SELECT created_at, training_type
            FROM model_versions
            WHERE training_type = 'full_retrain'
            ORDER BY created_at DESC
            LIMIT 1
        """)
    row = cur.fetchone()
    cur.close()
    
    if not row:
        # No full retrain yet, do one
        return True
    
    last_full_retrain = row[0]
    days_since = (time.time() - last_full_retrain.timestamp()) / 86400
    
    # Full retrain weekly (every 7 days)
    return days_since >= 7


def main():
    """Main retraining function."""
    parser = argparse.ArgumentParser(description="Retrain Dow30 RL model")
    parser.add_argument("--strategy", choices=["sortino", "upside"], default="sortino",
                        help="Strategy to retrain: sortino or upside")
    args = parser.parse_args()
    strategy = args.strategy
    
    print("=" * 60)
    print(f"Model Retraining Script (strategy={strategy})")
    print("=" * 60)
    
    reward_fn = get_reward_function(strategy)
    conn = get_db_connection(NEON_DATABASE_URL)
    
    try:
        # Ensure required tables exist
        cur = conn.cursor()
        cur.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'training_experiences'
            )
        """)
        if not cur.fetchone()[0]:
            cur.close()
            conn.close()
            print("\n✗ Database schema incomplete: training_experiences table not found.")
            print("  Run 'python setup_db.py' from the python_engine folder to apply the schema.")
            sys.exit(1)
        cur.close()
        
        # Update incomplete experiences first (with strategy-specific reward)
        update_incomplete_experiences(conn, reward_fn)
        
        # Load current model for this strategy
        print(f"\nLoading current {strategy} model...")
        model_dir = os.path.dirname(__file__)
        model = get_latest_model(NEON_DATABASE_URL, model_dir, strategy=strategy)
        if model is None:
            print("No model found. Running initial full training...")
            model = full_retrain(NEON_DATABASE_URL, model_dir=model_dir, strategy=strategy)
            training_type = "initial"
        else:
            # Decide: online update or full retrain?
            if should_full_retrain(conn, strategy=strategy):
                print("\nPerforming full retrain (weekly)...")
                model = full_retrain(NEON_DATABASE_URL, model_dir=model_dir, strategy=strategy)
                training_type = "full_retrain"
            else:
                print("\nPerforming online learning update...")
                # Load recent experiences
                experiences = load_experiences_from_db(conn, limit=5000)
                if experiences:
                    model = online_learning_update(model, conn, experiences, reward_fn, timesteps=2000)
                    training_type = "online"
                else:
                    print("No new experiences available. Skipping update.")
                    return
        
        # Count total experiences (refresh conn if we just did full_retrain - it may have timed out)
        conn.close()
        conn = get_db_connection(NEON_DATABASE_URL)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM training_experiences WHERE is_completed = TRUE")
        total_experiences = cur.fetchone()[0]
        cur.close()
        
        # Save new model version
        print(f"\nSaving model version (strategy={strategy}, training_type={training_type}, experiences={total_experiences})...")
        version = save_model_version(
            model,
            NEON_DATABASE_URL,
            model_dir=model_dir,
            training_type=training_type,
            total_experiences=total_experiences,
            notes=f"Daily retrain - {training_type}, strategy={strategy}",
            strategy=strategy
        )
        
        if version:
            print(f"\n✓ Retraining complete! Model version {version} saved and activated.")
        else:
            print("\n✗ Error saving model version")
            
    except Exception as e:
        print(f"\n✗ Error during retraining: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
