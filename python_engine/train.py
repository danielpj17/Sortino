import os
import argparse
import yfinance as yf
import numpy as np
import pandas as pd
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from gym_anytrading.envs import StocksEnv
import gymnasium as gym
from dotenv import load_dotenv
from model_manager import save_model_version, get_reward_function

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

# --- CUSTOM WRAPPER ---
# Gymnasium compatibility + strategy-specific reward (from model_manager).
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

# The Dow Jones Industrial Average (Dow 30) - WBA removed
DOW_30 = [
    'AXP', 'AMGN', 'AAPL', 'BA', 'CAT', 'CSCO', 'CVX', 'GS', 'HD', 'HON',
    'IBM', 'INTC', 'JNJ', 'KO', 'JPM', 'MCD', 'MMM', 'MRK', 'MSFT', 'NKE',
    'PG', 'TRV', 'UNH', 'CRM', 'VZ', 'V', 'WMT', 'DIS', 'DOW'
]

def train_model(strategy: str = "sortino"):
    model = None
    save_path = f"dow30_{strategy}_model.zip"
    reward_fn = get_reward_function(strategy)

    print(f"Starting training on {len(DOW_30)} assets (strategy={strategy})...")
    
    for i, ticker in enumerate(DOW_30):
        print(f"\n[{i+1}/{len(DOW_30)}] Processing {ticker}...")
        
        try:
            # 1. Download Data
            df = yf.download(ticker, start='2015-01-01', end='2024-01-01', progress=False)
            
            # --- DATA SANITIZATION ---
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df = df.loc[:, ~df.columns.duplicated()]
            df.dropna(inplace=True)
            # -------------------------
            
            if len(df) < 100:
                print(f"Skipping {ticker}: Not enough data (Rows: {len(df)}).")
                continue

            # 2. Create Environment using our Custom Wrapper (capture df by value)
            GymnasiumWrapper = make_gymnasium_wrapper(reward_fn)
            env = DummyVecEnv([lambda d=df: GymnasiumWrapper(d)])

            # 3. Initialize or Update Model
            if model is None:
                print("Initializing new PPO Agent...")
                model = PPO('MlpPolicy', env, verbose=0)
            else:
                model.set_env(env)

            # 4. Train
            model.learn(total_timesteps=5000)
            
        except Exception as e:
            print(f"Error training on {ticker}: {e}")

    # 5. Save Final Model
    if model:
        # Save to default path for backward compatibility
        model.save(save_path)
        print(f"\nModel saved to {save_path}")
        
        # Also save with versioning if database is available
        if NEON_DATABASE_URL:
            try:
                version = save_model_version(
                    model,
                    NEON_DATABASE_URL,
                    training_type="initial",
                    total_experiences=0,
                    notes=f"Initial training on historical data (2015-2024), strategy={strategy}",
                    strategy=strategy
                )
                if version:
                    print(f"Model version {version} saved to database")
            except Exception as e:
                print(f"Warning: Could not save model version to database: {e}")
        
        print(f"\nSUCCESS: Multi-Asset Model training complete")
    else:
        print("\nFAILURE: Model was never initialized.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Dow30 RL model")
    parser.add_argument("--reward", choices=["sortino", "upside"], default="sortino",
                        help="Reward strategy: sortino (loss-averse) or upside (gain-focused)")
    args = parser.parse_args()
    train_model(strategy=args.reward)