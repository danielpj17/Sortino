"""
Model API Service – Flask app for Sortino model predictions.
Deploy separately (Render, Railway, etc.) and set MODEL_API_URL in Vercel.

Endpoints:
  GET  /health  – status and model load check
  POST /predict – { "ticker": "AAPL", "period": "1mo" } -> { "action": "BUY"|"SELL", "price", ... }
"""

import os
import sys
import json
import time
import threading
import traceback
import numpy as np
import pandas as pd
import requests
import yfinance as yf
from flask import Flask, request, jsonify
from flask_cors import CORS
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from gym_anytrading.envs import StocksEnv
import gymnasium as gym
from dotenv import load_dotenv

# region agent log
def _debug_log(location: str, message: str, data: dict, hypothesis_id: str = "A"):
    _log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".cursor")
    _log_path = os.path.join(_log_dir, "debug.log")
    try:
        os.makedirs(_log_dir, exist_ok=True)
        payload = {"location": location, "message": message, "data": {k: str(v) if not isinstance(v, (int, float, bool, str, type(None))) else v for k, v in data.items()}, "timestamp": int(time.time() * 1000), "sessionId": "debug-session", "runId": "run1", "hypothesisId": hypothesis_id}
        with open(_log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass
# endregion

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
MODELS = {}  # keyed by strategy: 'sortino', 'upside'
# Per-strategy metadata after load: version_number, display_name, model_path, loaded_at (ISO UTC)
LOADED_META = {}
MODEL_RELOAD_LOCK = threading.Lock()
MODEL_RELOAD_INTERVAL = 3600  # seconds; match trade.py — poll DB for new active versions
LAST_DB_VERSION_CHECK = 0.0

# Map display names to API strategy keys
STRATEGY_NAME_TO_KEY = {
    "Sortino Model": "sortino",
    "Upside Model": "upside",
}


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


def _sync_loaded_meta_from_db():
    """Populate LOADED_META from DB for each key in MODELS; fallback rows if no DB row."""
    global LOADED_META
    from model_manager import get_active_version_rows

    db_url = os.getenv("DATABASE_URL")
    rows = get_active_version_rows(db_url) if db_url else {}
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    LOADED_META = {}
    for strat in list(MODELS.keys()):
        if strat in rows:
            LOADED_META[strat] = {**rows[strat], "loaded_at": now_iso}
        else:
            label = "Sortino_Model" if strat == "sortino" else "Upside_Model"
            LOADED_META[strat] = {
                "version_number": None,
                "model_path": None,
                "display_name": f"{label}_file",
                "created_at": None,
                "loaded_at": now_iso,
            }


def _should_reload_from_db() -> bool:
    """True if DB active version differs from what we think we loaded."""
    from model_manager import get_active_version_rows

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return False
    db_rows = get_active_version_rows(db_url)
    for strat in ("sortino", "upside"):
        db_ver = db_rows.get(strat, {}).get("version_number")
        loaded_ver = LOADED_META.get(strat, {}).get("version_number")
        if db_ver != loaded_ver:
            # DB has a new active version, or we only have file fallback (loaded_ver None) but DB has version
            if db_ver is not None:
                return True
    return False


def maybe_reload_models_if_stale():
    """Poll DB at most once per MODEL_RELOAD_INTERVAL; reload weights if active version changed."""
    global LAST_DB_VERSION_CHECK
    now = time.time()
    if now - LAST_DB_VERSION_CHECK < MODEL_RELOAD_INTERVAL:
        return
    with MODEL_RELOAD_LOCK:
        now = time.time()
        if now - LAST_DB_VERSION_CHECK < MODEL_RELOAD_INTERVAL:
            return
        LAST_DB_VERSION_CHECK = now
        if not _should_reload_from_db():
            return
        print("[model_api] DB active model version changed; reloading models...", flush=True)
        load_models()


def load_models():
    """Load both Sortino and Upside models on startup or after DB version change."""
    global MODELS
    try:
        from model_manager import get_latest_model
        db_url = os.getenv("DATABASE_URL")
        MODELS.clear()
        for strategy in ["sortino", "upside"]:
            try:
                model = None
                if db_url:
                    model = get_latest_model(db_url, MODEL_DIR, strategy=strategy)
                if model is None:
                    default_path = os.path.join(MODEL_DIR, f"dow30_{strategy}_model.zip")
                    if os.path.isfile(default_path):
                        model = PPO.load(default_path)
                if strategy == "sortino" and model is None:
                    # Legacy fallback
                    legacy_path = os.path.join(MODEL_DIR, "dow30_model.zip")
                    if os.path.isfile(legacy_path):
                        model = PPO.load(legacy_path)
                if model is not None:
                    MODELS[strategy] = model
                    print(f"[OK] Loaded {strategy} model", flush=True)
            except Exception as e:
                print(f"load_model ({strategy}) error: {e}", flush=True)
        _sync_loaded_meta_from_db()
        return len(MODELS) > 0
    except Exception as e:
        print("load_models error:", e, flush=True)
        return False


def _background_reload_loop():
    while True:
        time.sleep(MODEL_RELOAD_INTERVAL)
        try:
            maybe_reload_models_if_stale()
        except Exception as e:
            print(f"[model_api] background reload error: {e}", flush=True)


def _bootstrap_model_api():
    """Load weights once at import (gunicorn/python) and start hourly DB poll thread."""
    global LAST_DB_VERSION_CHECK
    print("=" * 50, flush=True)
    print("Sortino Model API — loading models...", flush=True)
    print(f"Model directory: {MODEL_DIR}", flush=True)
    try:
        if load_models():
            print(f"[OK] Loaded {len(MODELS)} model(s): {list(MODELS.keys())}", flush=True)
        else:
            print("[WARN] No models loaded. /predict will return 503 until models exist.", flush=True)
    except Exception as e:
        print(f"[ERROR] Loading models: {e}", flush=True)
        traceback.print_exc()
    LAST_DB_VERSION_CHECK = time.time()
    threading.Thread(target=_background_reload_loop, daemon=True).start()


@app.route("/", methods=["GET", "HEAD"])
def root():
    """Root route for Render health checks and browser visits."""
    return jsonify({"service": "Sortino Model API", "health": "/health", "predict": "POST /predict"})


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint - always returns 200, even if model not loaded."""
    from model_manager import get_active_version_rows

    db_url = os.getenv("DATABASE_URL")
    db_active = get_active_version_rows(db_url) if db_url else {}
    loaded_models = {k: dict(v) for k, v in LOADED_META.items()}
    return jsonify({
        "status": "ok",
        "models_loaded": {k: True for k in MODELS},
        "sortino_loaded": "sortino" in MODELS,
        "upside_loaded": "upside" in MODELS,
        "model_loaded": len(MODELS) > 0,
        "loaded_models": loaded_models,
        "db_active": db_active,
        "service": "Sortino Model API",
    })


@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json() or {}
        ticker = (data.get("ticker") or "").strip().upper()
        period = data.get("period") or "1mo"
        strategy_raw = (data.get("strategy") or "").strip()
        # Map display names to keys; default to sortino
        strategy = STRATEGY_NAME_TO_KEY.get(strategy_raw, strategy_raw.lower() if strategy_raw else "sortino")
        if strategy not in ("sortino", "upside"):
            strategy = "sortino"
        # region agent log
        _debug_log("model_api.py:predict", "predict_entry", {"ticker": ticker or "(empty)", "period": period, "strategy": strategy}, "H1")
        # endregion
        if not ticker:
            return jsonify({"error": "ticker required"}), 400

        model = MODELS.get(strategy) or MODELS.get("sortino")
        if model is None:
            return jsonify({"error": "model not loaded"}), 503

        # region agent log
        _debug_log("model_api.py:predict", "before_download", {"ticker": ticker, "period": period}, "H1")
        # endregion
        _max_attempts = 3
        raw = None
        _attempt_used = -1
        for _attempt in range(_max_attempts):
            # region agent log
            _debug_log("model_api.py:predict", "download_attempt", {"ticker": ticker, "attempt": _attempt + 1, "max_attempts": _max_attempts}, "H1")
            # endregion
            try:
                _start = time.time()
                raw = yf.download(ticker, period=period, interval="1d", progress=False)
                _duration_ms = int((time.time() - _start) * 1000)
                _attempt_used = _attempt + 1
                # region agent log
                _debug_log("model_api.py:predict", "download_success", {"ticker": ticker, "attempt": _attempt_used, "duration_ms": _duration_ms, "raw_empty": raw is None or (hasattr(raw, "empty") and raw.empty)}, "H2")
                # endregion
                break
            except Exception as _e:
                _msg = str(_e).lower()
                _is_timeout = "timeout" in _msg or "timed out" in _msg or "curl: (28)" in _msg
                _is_conn = "connection" in _msg or "broken pipe" in _msg or "curl: (56)" in _msg or "curl: (55)" in _msg
                # region agent log
                _debug_log("model_api.py:predict", "download_failed", {"ticker": ticker, "attempt": _attempt + 1, "exc_type": type(_e).__name__, "exc_msg": str(_e)[:300], "is_timeout": _is_timeout, "is_conn_err": _is_conn}, "H3")
                # endregion
                if _attempt + 1 >= _max_attempts:
                    raise
                _sleep = 1 + _attempt
                # region agent log
                _debug_log("model_api.py:predict", "download_retry_sleep", {"ticker": ticker, "sleep_sec": _sleep}, "H4")
                # endregion
                time.sleep(_sleep)
        # region agent log
        _raw_shape = getattr(raw, "shape", None) if raw is not None else None
        _raw_cols = list(getattr(raw, "columns", []))[:20] if raw is not None and hasattr(raw, "columns") else []
        _debug_log("model_api.py:predict", "after_download", {"raw_shape": _raw_shape, "raw_columns": _raw_cols, "attempt_used": _attempt_used}, "H1")
        # endregion
        df, err = sanitize_ohlcv(raw)
        # region agent log
        _debug_log("model_api.py:predict", "after_sanitize", {"df_len": len(df) if df is not None else 0, "err": err}, "H2")
        # endregion
        if err or df is None or len(df) < 15:
            return jsonify({"error": "insufficient or invalid data"}), 400

        df = df.reset_index(drop=True)
        # region agent log
        _debug_log("model_api.py:predict", "before_env", {"df_len": len(df)}, "H3")
        # endregion
        env = DummyVecEnv([lambda d=df: GymnasiumWrapper(d)])
        raw_obs = env.reset()
        obs = raw_obs[0] if isinstance(raw_obs, (list, tuple)) else raw_obs
        if not isinstance(obs, np.ndarray):
            obs = np.array(obs)
        # region agent log
        _debug_log("model_api.py:predict", "after_env_reset", {"obs_shape": getattr(obs, "shape", None), "obs_type": type(obs).__name__}, "H3")
        # endregion

        # region agent log
        _debug_log("model_api.py:predict", "before_predict", {"obs_shape": getattr(obs, "shape", None)}, "H4")
        # endregion
        action, _ = model.predict(obs, deterministic=True)
        action_code = int(action[0])
        action_type = "BUY" if action_code == 1 else "SELL"
        # region agent log
        _debug_log("model_api.py:predict", "after_predict", {"action": int(action[0])}, "H4")
        # endregion

        # Get action probabilities for more insight
        buy_prob = None
        sell_prob = None
        try:
            # Get the policy's action distribution
            import torch
            obs_tensor = model.policy.obs_to_tensor(obs)[0]
            distribution = model.policy.get_distribution(obs_tensor)
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
            traceback.print_exc()

        # Fallback: derive from action_code when probability extraction fails
        if buy_prob is None or sell_prob is None:
            buy_prob = 0.6 if action_code == 1 else 0.4
            sell_prob = 0.4 if action_code == 1 else 0.6

        # region agent log
        _debug_log("model_api.py:predict", "before_price_block", {"df_len": len(df)}, "H5")
        # endregion
        close = df["Close"].iloc[-1]
        price = float(close.iloc[0] if isinstance(close, pd.Series) else close)

        # Calculate some basic market indicators for context
        recent_prices = df["Close"].tail(10).values
        price_change_pct = ((recent_prices[-1] - recent_prices[0]) / recent_prices[0]) * 100 if len(recent_prices) > 0 else 0
        volatility = float(df["Close"].tail(10).std()) if len(df) >= 10 else 0

        # region agent log
        _debug_log("model_api.py:predict", "predict_success", {"ticker": ticker, "action": action_type}, "H5")
        # endregion
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
        # region agent log
        _tb = traceback.format_exc()
        _debug_log("model_api.py:predict", "predict_exception", {"exc_type": type(e).__name__, "exc_msg": str(e), "tb": _tb[-2000:] if len(_tb) > 2000 else _tb}, "H_exc")
        # endregion
        print(f"[predict] Exception: {type(e).__name__}: {e}", flush=True)
        traceback.print_exc()
        _conn_like = isinstance(e, (ConnectionError, OSError, requests.exceptions.RequestException))
        _msg = str(e).lower()
        if _conn_like or "broken pipe" in _msg or "connection" in _msg or "curl" in _msg or "fetch" in _msg:
            return jsonify({"error": "Market data temporarily unavailable", "detail": str(e)}), 503
        return jsonify({"error": str(e)}), 500


_bootstrap_model_api()

if __name__ == "__main__":
    print(f"Python version: {sys.version}", flush=True)
    print(f"Working directory: {os.getcwd()}", flush=True)
    port = int(os.getenv("PORT", 5000))
    print(f"Starting Flask dev server on port {port}...", flush=True)
    try:
        app.run(host="0.0.0.0", port=port, debug=False)
    except Exception as e:
        print(f"[ERROR] Failed to start Flask app: {e}", flush=True)
        traceback.print_exc()
        raise
