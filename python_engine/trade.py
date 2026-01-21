
import os
import psycopg2
import alpaca_trade_api as tradeapi
import yfinance as yf
from stable_baselines3 import PPO
import gym
import gym_anytrading
import pandas as pd
from datetime import datetime

# Environment Variables (Set these in your local environment)
ALPACA_KEY = os.getenv('ALPACA_KEY')
ALPACA_SECRET = os.getenv('ALPACA_SECRET')
ALPACA_BASE_URL = 'https://paper-api.alpaca.markets'
NEON_DATABASE_URL = os.getenv('DATABASE_URL') # postgres://user:pass@host/db

def execute_trade():
    # 1. Connect to Alpaca
    alpaca = tradeapi.REST(ALPACA_KEY, ALPACA_SECRET, ALPACA_BASE_URL, api_version='v2')
    
    # 2. Load Model
    model = PPO.load("aapl_model.zip")
    
    # 3. Fetch Real-Time Data (Latest 20 days to support window_size)
    ticker = 'AAPL'
    data = yf.download(ticker, period='1mo', interval='1d')
    
    # 4. Setup dummy env for prediction matching training shape
    env = gym.make('stocks-v0', df=data, frame_bound=(10, len(data)), window_size=10)
    obs = env.reset()
    
    # 5. Predict
    action, _states = model.predict(obs)
    
    # Actions: 0 (Sell), 1 (Buy) - depending on gym-anytrading config
    action_type = "BUY" if action == 1 else "SELL"
    current_price = data['Close'].iloc[-1]
    qty = 1 # Simple unit for demo
    
    print(f"Model recommendation: {action_type} at ${current_price:.2f}")

    try:
        # 6. Execute via Alpaca Paper
        alpaca.submit_order(
            symbol=ticker,
            qty=qty,
            side=action_type.lower(),
            type='market',
            time_in_force='gtc'
        )
        print("Trade submitted to Alpaca.")

        # 7. Log to Neon DB
        conn = psycopg2.connect(NEON_DATABASE_URL)
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO trades (ticker, action, price, quantity, strategy) VALUES (%s, %s, %s, %s, %s)",
            (ticker, action_type, float(current_price), qty, "PPO-Alpha-v1")
        )
        conn.commit()
        cur.close()
        conn.close()
        print("Trade logged to Neon Database.")

    except Exception as e:
        print(f"Error executing trade: {e}")

if __name__ == "__main__":
    execute_trade()
