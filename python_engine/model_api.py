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
from dotenv import load_dotenv
from feature_env import FeatureEnrichedEnv

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
# Per-strategy record of what get_latest_model ACTUALLY loaded from disk (see
# model_manager.get_latest_model info_out). Keeps the reported version honest when
# the DB active version's zip is missing and an older model is silently substituted.
LOAD_INFO = {}
MODEL_RELOAD_LOCK = threading.Lock()
MODEL_RELOAD_INTERVAL = 3600  # seconds; match trade.py — poll DB for new active versions
LAST_DB_VERSION_CHECK = 0.0

# Startup state. Model loading takes minutes on a cold host, so it runs in a
# background thread AFTER the port is bound — a platform that probes for an open
# port (Render, Railway, Fly) fails the deploy if the process loads weights first.
MODELS_READY = False
MODELS_LOADING = False
MODELS_LOAD_ERROR = None
BOOTSTRAP_STARTED_AT = 0.0
MODELS_LOADED_AT = 0.0
_BOOTSTRAP_LOCK = threading.Lock()
_BOOTSTRAP_STARTED = False

# Map display names to API strategy keys
STRATEGY_NAME_TO_KEY = {
    "Sortino Model": "sortino",
    "Upside Model": "upside",
}



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
    """
    Populate LOADED_META with what is genuinely loaded in this process.

    This must NOT simply echo the DB row back: when the DB's active version file is
    missing, get_latest_model falls back to an older zip, and copying the DB row
    here would report the new version number while serving the old weights — which
    is exactly the mismatch /health and api/trading/diagnostics.js exist to catch.
    """
    global LOADED_META
    from model_manager import get_active_version_rows, display_name_for_fallback_file

    db_url = os.getenv("DATABASE_URL")
    rows = get_active_version_rows(db_url, MODEL_DIR) if db_url else {}
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta = {}
    for strat in list(MODELS.keys()):
        info = LOAD_INFO.get(strat, {})
        is_fallback = bool(info.get("is_fallback"))
        if not is_fallback and strat in rows:
            # Loaded exactly what the DB points at.
            meta[strat] = {**rows[strat], "loaded_at": now_iso, "is_fallback": False}
        elif is_fallback:
            # Report the file actually in memory, not the DB's aspiration.
            meta[strat] = {
                "version_number": info.get("loaded_version"),
                "model_path": os.path.basename(info.get("loaded_path") or "") or None,
                "display_name": display_name_for_fallback_file(strat, MODEL_DIR),
                "created_at": None,
                "loaded_at": now_iso,
                "is_fallback": True,
                "fallback_reason": info.get("fallback_reason"),
                "expected_version": info.get("db_version"),
                "expected_model_path": info.get("db_model_path"),
            }
        else:
            meta[strat] = {
                "version_number": None,
                "model_path": None,
                "display_name": display_name_for_fallback_file(strat, MODEL_DIR),
                "created_at": None,
                "loaded_at": now_iso,
                "is_fallback": False,
            }
    LOADED_META = meta


def model_version_issues():
    """List of human-readable stale/missing-model problems, empty when healthy."""
    issues = []
    for strat in sorted(LOADED_META):
        m = LOADED_META[strat]
        if m.get("is_fallback"):
            exp = m.get("expected_version")
            if exp is not None:
                issues.append(
                    f"{strat}: DB active version {exp} ({m.get('expected_model_path')}) is not "
                    f"present on this host; serving {m.get('model_path')} instead"
                )
            else:
                issues.append(f"{strat}: {m.get('fallback_reason') or 'using fallback model file'}")
    return issues


def _should_reload_from_db() -> bool:
    """True if DB active version differs from what we think we loaded."""
    from model_manager import get_active_version_rows

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return False
    db_rows = get_active_version_rows(db_url, MODEL_DIR)
    for strat in ("sortino", "upside"):
        db_ver = db_rows.get(strat, {}).get("version_number")
        if db_ver is None:
            continue
        # Compare against the DB version we last ACTED on, not the one we managed to
        # load. If the active version's file is missing we already fell back once;
        # re-loading every hour would burn minutes of CPU to reach the same fallback.
        # Reload only when the DB row itself changes.
        seen_ver = LOAD_INFO.get(strat, {}).get("db_version")
        if db_ver != seen_ver:
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
    global MODELS, LOAD_INFO
    try:
        from model_manager import get_latest_model
        db_url = os.getenv("DATABASE_URL")
        # Build into locals and swap in at the end: /predict reads MODELS
        # concurrently, and clearing it up front makes every in-flight request
        # 503 for the minutes a reload takes.
        staged = {}
        staged_info = {}
        for strategy in ["sortino", "upside"]:
            try:
                model = None
                info = {}
                if db_url:
                    model = get_latest_model(db_url, MODEL_DIR, strategy=strategy, info_out=info)
                if model is None:
                    default_path = os.path.join(MODEL_DIR, f"dow30_{strategy}_model.zip")
                    if os.path.isfile(default_path):
                        model = PPO.load(default_path)
                        info = {**info, "loaded_path": default_path, "loaded_version": None,
                                "is_fallback": True,
                                "fallback_reason": info.get("fallback_reason") or "no DATABASE_URL"}
                if strategy == "sortino" and model is None:
                    # Legacy fallback
                    legacy_path = os.path.join(MODEL_DIR, "dow30_model.zip")
                    if os.path.isfile(legacy_path):
                        model = PPO.load(legacy_path)
                        info = {**info, "loaded_path": legacy_path, "loaded_version": None,
                                "is_fallback": True,
                                "fallback_reason": info.get("fallback_reason") or "no DATABASE_URL"}
                if model is not None:
                    staged[strategy] = model
                    staged_info[strategy] = info
                    src = os.path.basename(info.get("loaded_path") or "unknown")
                    print(f"[OK] Loaded {strategy} model from {src}", flush=True)
            except Exception as e:
                print(f"load_model ({strategy}) error: {e}", flush=True)
        if not staged:
            return False
        MODELS = staged
        LOAD_INFO = staged_info
        _sync_loaded_meta_from_db()
        for issue in model_version_issues():
            print(f"[STALE MODEL] {issue}", flush=True)
        return True
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
    """Load weights and start the hourly DB poll thread. Runs off the main thread."""
    global LAST_DB_VERSION_CHECK, MODELS_READY, MODELS_LOADING, MODELS_LOAD_ERROR
    global MODELS_LOADED_AT
    print("=" * 50, flush=True)
    print("Sortino Model API — loading models...", flush=True)
    print(f"Model directory: {MODEL_DIR}", flush=True)
    started = time.time()
    try:
        if load_models():
            MODELS_READY = True
            MODELS_LOADED_AT = time.time()
            print(
                f"[OK] Loaded {len(MODELS)} model(s): {list(MODELS.keys())} "
                f"in {time.time() - started:.1f}s",
                flush=True,
            )
        else:
            MODELS_LOAD_ERROR = "no model files could be loaded"
            print("[WARN] No models loaded. /predict will return 503 until models exist.", flush=True)
    except Exception as e:
        MODELS_LOAD_ERROR = f"{type(e).__name__}: {e}"
        print(f"[ERROR] Loading models: {e}", flush=True)
        traceback.print_exc()
    finally:
        MODELS_LOADING = False
    LAST_DB_VERSION_CHECK = time.time()
    threading.Thread(target=_background_reload_loop, daemon=True).start()


def start_bootstrap_async():
    """
    Kick off model loading in the background, exactly once per process.

    Deliberately does not block: the WSGI server must bind its port immediately so
    the host's port scan succeeds. Until loading finishes, /health answers 200 with
    models_ready=false and /predict answers 503.
    """
    global _BOOTSTRAP_STARTED, MODELS_LOADING, BOOTSTRAP_STARTED_AT
    with _BOOTSTRAP_LOCK:
        if _BOOTSTRAP_STARTED:
            return
        _BOOTSTRAP_STARTED = True
        MODELS_LOADING = True
        BOOTSTRAP_STARTED_AT = time.time()
    threading.Thread(target=_bootstrap_model_api, name="model-bootstrap", daemon=True).start()


@app.route("/", methods=["GET", "HEAD"])
def root():
    """Root route for Render health checks and browser visits."""
    return jsonify({"service": "Sortino Model API", "health": "/health", "predict": "POST /predict"})


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint - always returns 200, even if model not loaded."""
    from model_manager import get_active_version_rows

    db_url = os.getenv("DATABASE_URL")
    db_active = get_active_version_rows(db_url, MODEL_DIR) if db_url else {}
    loaded_models = {k: dict(v) for k, v in LOADED_META.items()}
    issues = model_version_issues()
    return jsonify({
        "status": "ok",
        "models_loaded": {k: True for k in MODELS},
        "sortino_loaded": "sortino" in MODELS,
        "upside_loaded": "upside" in MODELS,
        "model_loaded": len(MODELS) > 0,
        "models_ready": MODELS_READY,
        "models_loading": MODELS_LOADING,
        "models_load_error": MODELS_LOAD_ERROR,
        "load_seconds": (
            round((MODELS_LOADED_AT or time.time()) - BOOTSTRAP_STARTED_AT, 1)
            if BOOTSTRAP_STARTED_AT else None
        ),
        "loaded_models": loaded_models,
        "db_active": db_active,
        "version_issues": issues,
        "version_mismatch": bool(issues),
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
            if MODELS_LOADING:
                # Transient: the process is up but still loading weights. Callers
                # should retry rather than record a permanent failure.
                return jsonify({
                    "error": "model still loading",
                    "models_loading": True,
                    "elapsed_seconds": round(time.time() - BOOTSTRAP_STARTED_AT, 1),
                }), 503
            return jsonify({"error": "model not loaded", "models_loading": False}), 503

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
        if err or df is None or len(df) < 25:
            return jsonify({"error": "insufficient or invalid data"}), 400

        df = df.reset_index(drop=True)
        # region agent log
        _debug_log("model_api.py:predict", "before_env", {"df_len": len(df)}, "H3")
        # endregion
        env = DummyVecEnv([lambda d=df: FeatureEnrichedEnv(d)])
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

        # If probability extraction failed, signal the caller to skip rather than fabricating values
        prob_extraction_failed = buy_prob is None or sell_prob is None

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
        response = {
            "ticker": ticker,
            "action": action_type,
            "action_code": action_code,
            "price": price,
            "buy_probability": buy_prob,
            "sell_probability": sell_prob,
            "price_change_10d_pct": round(price_change_pct, 2),
            "volatility_10d": round(volatility, 2),
            "data_points": len(df),
        }
        if prob_extraction_failed:
            response["probability_extraction_failed"] = True
        return jsonify(response)
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


# Start loading in the background at import time. Under gunicorn this runs in the
# worker; under `python model_api.py` it overlaps with app.run() below. Either way
# the port is bound within seconds instead of after a multi-minute model load.
start_bootstrap_async()

if __name__ == "__main__":
    print(f"Python version: {sys.version}", flush=True)
    print(f"Working directory: {os.getcwd()}", flush=True)
    port = int(os.getenv("PORT", 5000))
    print(f"Binding port {port} now; models continue loading in the background.", flush=True)
    try:
        app.run(host="0.0.0.0", port=port, debug=False)
    except Exception as e:
        print(f"[ERROR] Failed to start Flask app: {e}", flush=True)
        traceback.print_exc()
        raise
