"""
Model API Service – Flask app for Sortino model predictions.
Deploy separately (Render, Railway, etc.) and set MODEL_API_URL in Vercel.

Endpoints:
  GET  /health  – status and model load check
  POST /predict – { "ticker": "AAPL", "period": "1mo" } -> { "action": "BUY"|"SELL", "price", ... }
"""

import os
import sys
import numpy as np
import pandas as pd
import yfinance as yf
from flask import Flask, request, jsonify
from flask_cors import CORS
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from gym_anytrading.envs import StocksEnv
import gymnasium as gym
from dotenv import load_dotenv

for _d in [
    os.path.join(os.path.dirname(__file__), ".."),
    os.path.dirname(__file__),
]:
    _e = os.path.join(_d, ".env")
    if os.path.isfile(_e):
        load_dotenv(_e)
        break
else:
    load_dotenv()

app = Flask(__name__)
CORS(app)

MODEL_DIR = os.path.dirname(__file__)
REQUIRED_COLS = ["Open", "High", "Low", "Close", "Volume"]
MODEL = None


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
        reward = out[1]
        term = out[2] if len(out) > 2 else False
        trunc = out[3] if len(out) > 3 else False
        info = out[4] if len(out) > 4 else {}
        return obs, reward, term, trunc, info

    def render(self):
        return self.env.render()


def sanitize_ohlcv(df):
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


def load_model():
    global MODEL
    try:
        from model_manager import get_latest_model
        db_url = os.getenv("DATABASE_URL")
        if db_url:
            MODEL = get_latest_model(db_url, MODEL_DIR)
        if MODEL is None:
            default_path = os.path.join(MODEL_DIR, "dow30_model.zip")
            if os.path.isfile(default_path):
                MODEL = PPO.load(default_path)
        return MODEL is not None
    except Exception as e:
        print("load_model error:", e)
        return False


@app.route("/", methods=["GET", "HEAD"])
def root():
    """Root route for Render health checks and browser visits."""
    return jsonify({"service": "Sortino Model API", "health": "/health", "predict": "POST /predict"})


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint - always returns 200, even if model not loaded."""
    model_file_exists = os.path.isfile(os.path.join(MODEL_DIR, "dow30_model.zip"))
    return jsonify({
        "status": "ok",
        "model_loaded": MODEL is not None,
        "model_file_exists": model_file_exists,
        "service": "Sortino Model API"
    })


@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json() or {}
        ticker = (data.get("ticker") or "").strip().upper()
        period = data.get("period") or "1mo"
        if not ticker:
            return jsonify({"error": "ticker required"}), 400

        if MODEL is None:
            return jsonify({"error": "model not loaded"}), 503

        raw = yf.download(ticker, period=period, interval="1d", progress=False)
        df, err = sanitize_ohlcv(raw)
        if err or df is None or len(df) < 15:
            return jsonify({"error": "insufficient or invalid data"}), 400

        df = df.reset_index(drop=True)
        env = DummyVecEnv([lambda d=df: GymnasiumWrapper(d)])
        raw_obs = env.reset()
        obs = raw_obs[0] if isinstance(raw_obs, (list, tuple)) else raw_obs
        if not isinstance(obs, np.ndarray):
            obs = np.array(obs)

        action, _ = MODEL.predict(obs, deterministic=True)
        action_code = int(action[0])
        action_type = "BUY" if action_code == 1 else "SELL"
        
        # Get action probabilities for more insight
        buy_prob = None
        sell_prob = None
        try:
            # Get the policy's action distribution
            import torch
            obs_tensor = MODEL.policy.obs_to_tensor(obs)[0]
            distribution = MODEL.policy.get_distribution(obs_tensor)
            # For discrete action space, get probabilities
            if hasattr(distribution.distribution, 'probs'):
                action_probs = distribution.distribution.probs.detach().cpu().numpy()
                if len(action_probs.shape) > 1:
                    action_probs = action_probs[0]  # Take first batch element
                buy_prob = float(action_probs[1]) if len(action_probs) > 1 else 0.0
                sell_prob = float(action_probs[0]) if len(action_probs) > 0 else 0.0
            elif hasattr(distribution.distribution, 'logits'):
                # If using logits, convert to probabilities
                logits = distribution.distribution.logits.detach().cpu().numpy()
                if len(logits.shape) > 1:
                    logits = logits[0]
                # np is already imported at the top of the file
                probs = np.exp(logits) / np.sum(np.exp(logits))
                buy_prob = float(probs[1]) if len(probs) > 1 else 0.0
                sell_prob = float(probs[0]) if len(probs) > 0 else 0.0
        except Exception as e:
            # If we can't get probabilities, log the error but continue
            print(f"Could not get action probabilities: {e}")
            import traceback
            traceback.print_exc()
        
        close = df["Close"].iloc[-1]
        price = float(close.iloc[0] if isinstance(close, pd.Series) else close)
        
        # Calculate some basic market indicators for context
        recent_prices = df["Close"].tail(10).values
        price_change_pct = ((recent_prices[-1] - recent_prices[0]) / recent_prices[0]) * 100 if len(recent_prices) > 0 else 0
        volatility = float(df["Close"].tail(10).std()) if len(df) >= 10 else 0

        return jsonify({
            "ticker": ticker,
            "action": action_type,
            "action_code": action_code,
            "price": price,
            "buy_probability": buy_prob,
            "sell_probability": sell_prob,
            "price_change_10d_pct": round(price_change_pct, 2),
            "volatility_10d": round(volatility, 2),
            "data_points": len(df),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    print("=" * 50)
    print("Starting Sortino Model API...")
    print(f"Python version: {sys.version}")
    print(f"Working directory: {os.getcwd()}")
    print(f"Model directory: {MODEL_DIR}")
    print(f"Model file exists: {os.path.isfile(os.path.join(MODEL_DIR, 'dow30_model.zip'))}")
    print("=" * 50)
    
    print("Loading model...")
    try:
        if load_model():
            print("✅ Model loaded successfully.")
        else:
            print("⚠️  Warning: model not loaded. API will return 503 for /predict.")
    except Exception as e:
        print(f"❌ Error loading model: {e}")
        import traceback
        traceback.print_exc()
    
    port = int(os.getenv("PORT", 5000))
    print(f"Starting Flask app on port {port}...")
    try:
        app.run(host="0.0.0.0", port=port, debug=False)
    except Exception as e:
        print(f"❌ Failed to start Flask app: {e}")
        import traceback
        traceback.print_exc()
        raise
