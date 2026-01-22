import yfinance as yf
import numpy as np
import pandas as pd
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
# Import the old environment
from gym_anytrading.envs import StocksEnv
import gymnasium as gym  # We need gymnasium for the wrapper

# --- CUSTOM WRAPPER (The Fix) ---
# This manually forces the old Gym env to behave like a new Gymnasium env
class GymnasiumWrapper(gym.Env):
    def __init__(self, df):
        super().__init__()
        # Create the old env
        self.env = StocksEnv(df=df, window_size=10, frame_bound=(10, len(df)))
        # Copy spaces (they are compatible enough)
        self.action_space = self.env.action_space
        self.observation_space = self.env.observation_space
    
    def reset(self, seed=None, options=None):
        # Old Gym returns just obs; New Gymnasium returns (obs, info)
        obs = self.env.reset()
        return obs, {}
    
    def step(self, action):
        # Old Gym: obs, reward, done, info
        obs, reward, done, info = self.env.step(action)
        # New Gymnasium: obs, reward, terminated, truncated, info
        return obs, reward, done, False, info
    
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

            # 2. Create Environment using our Custom Wrapper
            env = DummyVecEnv([lambda: GymnasiumWrapper(df)])

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