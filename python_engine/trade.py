import os
import time
import json
import psycopg2
import alpaca_trade_api as tradeapi
import yfinance as yf
import pandas as pd
import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from gym_anytrading.envs import StocksEnv
import gymnasium as gym
from dotenv import load_dotenv

# Debug logging helper
LOG_PATH = r"c:\Users\danie\Downloads\AI Stuff\Sortino\.cursor\debug.log"
def debug_log(hypothesis_id, location, message, data):
    try:
        with open(LOG_PATH, 'a', encoding='utf-8') as f:
            log_entry = {
                "sessionId": "debug-session",
                "runId": "run1",
                "hypothesisId": hypothesis_id,
                "location": location,
                "message": message,
                "data": {k: str(v) if not isinstance(v, (int, float, bool, str, type(None))) else v for k, v in data.items()},
                "timestamp": int(time.time() * 1000)
            }
            f.write(json.dumps(log_entry) + '\n')
    except:
        pass

# Load keys
load_dotenv()
NEON_DATABASE_URL = os.getenv('DATABASE_URL')

# Dow 30 Tickers
DOW_30 = [
    'AXP', 'AMGN', 'AAPL', 'BA', 'CAT', 'CSCO', 'CVX', 'GS', 'HD', 'HON',
    'IBM', 'INTC', 'JNJ', 'KO', 'JPM', 'MCD', 'MMM', 'MRK', 'MSFT', 'NKE',
    'PG', 'TRV', 'UNH', 'CRM', 'VZ', 'V', 'WMT', 'DIS', 'DOW'
]

# --- CUSTOM WRAPPER (Required for compatibility) ---
class GymnasiumWrapper(gym.Env):
    def __init__(self, df):
        super().__init__()
        self.env = StocksEnv(df=df, window_size=10, frame_bound=(10, len(df)))
        self.action_space = self.env.action_space
        self.observation_space = self.env.observation_space
    
    def reset(self, seed=None, options=None):
        # Match train.py exactly: Old Gym returns just obs; New Gymnasium returns (obs, info)
        obs = self.env.reset()
        # Handle tuple return (StocksEnv might return tuple in some versions)
        if isinstance(obs, tuple):
            obs = obs[0]
        return obs, {}
    
    def step(self, action):
        # Old Gym: obs, reward, done, info
        obs, reward, done, info = self.env.step(action)
        # New Gymnasium: obs, reward, terminated, truncated, info
        return obs, reward, done, False, info

def get_db_connection():
    return psycopg2.connect(NEON_DATABASE_URL)

def execute_trade_cycle():
    print(f"--- Starting Dow 30 Trade Cycle at {time.ctime()} ---")
    
    # 1. Load Model
    try:
        model = PPO.load("dow30_model.zip")
        print("Dow 30 AI Model loaded.")
    except Exception as e:
        print(f"Error loading model: {e} (Run train.py first!)")
        return

    # 2. Iterate Stocks
    for ticker in DOW_30:
        try:
            # Fetch Data
            data = yf.download(ticker, period='1mo', interval='1d', progress=False)
            
            # --- DATA SANITIZATION (Must match train.py exactly) ---
            if isinstance(data.columns, pd.MultiIndex):
                data.columns = data.columns.get_level_values(0)
            data = data.loc[:, ~data.columns.duplicated()]
            data.dropna(inplace=True)
            
            # Ensure we have the required columns (Open, High, Low, Close, Volume)
            required_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
            missing_cols = [col for col in required_cols if col not in data.columns]
            if missing_cols:
                print(f"Skipping {ticker}: Missing required columns: {missing_cols}")
                continue
            
            # Select only the required columns in the correct order
            data = data[required_cols].copy()
            
            # Ensure all columns are numeric
            for col in required_cols:
                data[col] = pd.to_numeric(data[col], errors='coerce')
            data.dropna(inplace=True)
            
            if len(data) < 15: 
                print(f"Skipping {ticker}: Not enough data ({len(data)} rows).")
                continue
            
            # Ensure data is properly indexed (reset index to ensure clean integer index)
            data = data.reset_index(drop=True)

            # #region agent log
            debug_log("H", f"execute_trade_cycle:{ticker}:data_prepared", "Data prepared for environment", {
                "ticker": ticker,
                "data_shape": str(data.shape),
                "data_columns": str(list(data.columns)),
                "data_dtypes": {col: str(dtype) for col, dtype in data.dtypes.items()}
            })
            # #endregion

            # 3. Create Vectorized Environment (Matches Training)
            # This wrapper handles the batch dimension and data format automatically
            # Use a factory function that captures the data properly
            def make_env():
                return GymnasiumWrapper(data)
            
            # #region agent log
            debug_log("I", f"execute_trade_cycle:{ticker}:creating_env", "Creating DummyVecEnv", {"ticker": ticker})
            # #endregion
            
            env = DummyVecEnv([make_env])
            
            # #region agent log
            debug_log("J", f"execute_trade_cycle:{ticker}:before_reset", "About to call env.reset()", {"ticker": ticker})
            # #endregion
            
            # Reset returns just the observation (batch format), which is exactly what predict() needs
            try:
                obs = env.reset()
                
                # #region agent log
                debug_log("K", f"execute_trade_cycle:{ticker}:after_reset", "env.reset() succeeded", {
                    "ticker": ticker,
                    "obs_type": str(type(obs)),
                    "obs_shape": str(obs.shape) if isinstance(obs, np.ndarray) else "N/A",
                    "obs_ndim": obs.ndim if isinstance(obs, np.ndarray) else "N/A"
                })
                # #endregion
            except Exception as e:
                # #region agent log
                debug_log("L", f"execute_trade_cycle:{ticker}:reset_error", "Error in env.reset()", {
                    "ticker": ticker,
                    "error": str(e),
                    "error_type": str(type(e).__name__)
                })
                # #endregion
                print(f"Skipping {ticker}: Error resetting environment: {e}")
                continue
            
            # Ensure obs is a numpy array with consistent shape
            if not isinstance(obs, np.ndarray):
                obs = np.array(obs)
            
            # Predict
            # #region agent log
            debug_log("M", f"execute_trade_cycle:{ticker}:before_predict", "About to call model.predict()", {
                "ticker": ticker,
                "obs_shape": str(obs.shape),
                "obs_ndim": obs.ndim,
                "obs_dtype": str(obs.dtype),
                "model_observation_space": str(model.observation_space) if hasattr(model, 'observation_space') else "N/A"
            })
            # #endregion
            
            try:
                action, _ = model.predict(obs, deterministic=True)
                
                # #region agent log
                debug_log("N", f"execute_trade_cycle:{ticker}:after_predict", "model.predict() succeeded", {
                    "ticker": ticker,
                    "action": str(action),
                    "action_shape": str(action.shape) if isinstance(action, np.ndarray) else "N/A"
                })
                # #endregion
            except Exception as e:
                # #region agent log
                debug_log("O", f"execute_trade_cycle:{ticker}:predict_error", "Error in model.predict()", {
                    "ticker": ticker,
                    "error": str(e),
                    "error_type": str(type(e).__name__),
                    "obs_shape": str(obs.shape),
                    "obs_ndim": obs.ndim
                })
                # #endregion
                print(f"Skipping {ticker}: Error predicting: {e}")
                continue
            
            # Action is an array like [1] or [0]
            action_type = "BUY" if action[0] == 1 else "SELL"
            
            current_price = data['Close'].iloc[-1]
            if isinstance(current_price, pd.Series):
                current_price = float(current_price.iloc[0])
            else:
                current_price = float(current_price)

            print(f"Analyzed {ticker}: Signal {action_type} @ ${current_price:.2f}")

            # 4. Execute in Database/Alpaca
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute("SELECT id, api_key, secret_key, type FROM accounts")
            accounts = cur.fetchall()

            if not accounts:
                print("No accounts found in DB.")

            for acc in accounts:
                acc_id, api_key, secret_key, acc_type = acc
                base_url = 'https://paper-api.alpaca.markets' if acc_type == 'Paper' else 'https://api.alpaca.markets'
                
                try:
                    alpaca = tradeapi.REST(api_key, secret_key, base_url, api_version='v2')
                    qty = 1 
                    
                    acct = alpaca.get_account()
                    if action_type == "BUY" and float(acct.buying_power) < current_price:
                        print(f"  [{acc_id}] Insufficient funds for {ticker}")
                        continue

                    alpaca.submit_order(symbol=ticker, qty=qty, side=action_type.lower(), type='market', time_in_force='gtc')
                    
                    cur.execute(
                        "INSERT INTO trades (timestamp, ticker, action, price, quantity, strategy, pnl, account_id) VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s)",
                        (ticker, action_type, current_price, qty, "Dow30-AI-v1", 0.00, acc_id)
                    )
                    conn.commit()
                    print(f"  [{acc_id}] Executed {action_type} {ticker}")
                    
                except Exception as e:
                    print(f"  [{acc_id}] Order Error: {e}")

            cur.close()
            conn.close()

        except Exception as e:
            print(f"Skipping {ticker}: {e}")

if __name__ == "__main__":
    execute_trade_cycle()