import yfinance as yf
import numpy as np
import pandas as pd
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from gym_anytrading.envs import StocksEnv
import gymnasium as gym

# Sortino-style reward: penalize downside volatility heavily.
DOWNSIDE_PENALTY_FACTOR = 2.0   # multiply negative rewards (e.g. x2)
DOWNSIDE_SQUARED = True         # square magnitude for heavier penalty on large losses

def _sortino_reward(raw_reward: float) -> float:
    """Apply Sortino principle: heavy penalty for negative returns."""
    if raw_reward >= 0:
        return raw_reward
    mag = abs(raw_reward)
    if DOWNSIDE_SQUARED:
        return -(DOWNSIDE_PENALTY_FACTOR * (mag ** 2))
    return raw_reward * DOWNSIDE_PENALTY_FACTOR

# --- CUSTOM WRAPPER ---
# Gymnasium compatibility + Sortino custom reward (penalize downside volatility).
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
        reward = _sortino_reward(raw_reward)
        return obs, reward, terminated, truncated, info

    def render(self):
        return self.env.render()

# The Dow Jones Industrial Average (Dow 30) - WBA removed
DOW_30 = [
    'AXP', 'AMGN', 'AAPL', 'BA', 'CAT', 'CSCO', 'CVX', 'GS', 'HD', 'HON',
    'IBM', 'INTC', 'JNJ', 'KO', 'JPM', 'MCD', 'MMM', 'MRK', 'MSFT', 'NKE',
    'PG', 'TRV', 'UNH', 'CRM', 'VZ', 'V', 'WMT', 'DIS', 'DOW'
]

def train_model():
    model = None
    save_path = "dow30_model.zip"

    print(f"Starting training on {len(DOW_30)} assets...")
    
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
        model.save(save_path)
        print(f"\nSUCCESS: Multi-Asset Model saved to {save_path}")
    else:
        print("\nFAILURE: Model was never initialized.")

if __name__ == "__main__":
    train_model()