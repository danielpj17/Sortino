"""
Swing Trading Bot Daemon — Production-grade AI trader.
Runs 24/7: analyzes every 60s when market open; sleeps until 9:30 AM ET when closed.
Uses per-account settings (allow_shorting, max_position_size), dynamic position sizing,
and Sortino-aware execution (close long / open short only if allowed).
"""
import os
import sys
import time
import json
from datetime import datetime, timezone
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
from model_manager import get_latest_model

# Load env from project root and python_engine
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

# Debug logging (optional)
LOG_DIR = os.path.join(os.path.dirname(__file__), "..")
LOG_PATH = os.path.join(LOG_DIR, "trade_debug.log")


def debug_log(location: str, message: str, data: dict) -> None:
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            entry = {
                "location": location,
                "message": message,
                "data": {k: str(v) if not isinstance(v, (int, float, bool, str, type(None))) else v for k, v in data.items()},
                "timestamp": int(time.time() * 1000),
            }
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


DOW_30 = [
    "AXP", "AMGN", "AAPL", "BA", "CAT", "CSCO", "CVX", "GS", "HD", "HON",
    "IBM", "INTC", "JNJ", "KO", "JPM", "MCD", "MMM", "MRK", "MSFT", "NKE",
    "PG", "TRV", "UNH", "CRM", "VZ", "V", "WMT", "DIS", "DOW",
]

REQUIRED_COLS = ["Open", "High", "Low", "Close", "Volume"]
ANALYSIS_INTERVAL_SEC = 60
MODEL_PATH = os.path.join(os.path.dirname(__file__), "dow30_model.zip")
STRATEGY_NAME = "Dow30-Swing-Sortino"
MODEL_RELOAD_INTERVAL = 3600  # Reload model every hour to check for updates


# --- Env wrapper (must match train.py observation/action shape) ---
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
        obs, reward = out[0], out[1]
        term = out[2] if len(out) > 2 else False
        trunc = out[3] if len(out) > 3 else False
        info = out[4] if len(out) > 4 else {}
        return obs, reward, term, trunc, info


def get_db():
    return psycopg2.connect(NEON_DATABASE_URL)


def fetch_accounts(conn):
    """Fetch accounts with bot settings: id, api_key, secret_key, type, allow_shorting, max_position_size.
    Now fetches decrypted credentials from the API endpoint instead of directly from database.
    """
    import requests
    
    # Get decrypted credentials from API endpoint
    # This endpoint should only be accessible from localhost
    api_url = os.getenv("API_BASE_URL", "http://localhost:3001")
    try:
        response = requests.get(f"{api_url}/api/accounts?decrypt=true", timeout=5)
        if response.status_code == 200:
            accounts = response.json()
            # Format: (id, api_key, secret_key, type, allow_shorting, max_position_size, account_type_display, cash_mode)
            rows = []
            for acc in accounts:
                rows.append((
                    acc['id'],
                    acc['api_key'],
                    acc['secret_key'],
                    acc['type'],
                    acc.get('allow_shorting', False),
                    float(acc.get('max_position_size', 0.40)),
                    acc.get('account_type_display', 'CASH'),
                    acc.get('cash_mode', 'SETTLED'),
                ))
            return rows
        else:
            print(f"Warning: Failed to fetch accounts from API (status {response.status_code}), falling back to database")
    except Exception as e:
        print(f"Warning: Failed to fetch accounts from API ({e}), falling back to database")
    
    # Fallback: query database directly (keys will be encrypted, so this won't work)
    # This is only for backward compatibility during migration
    cur = conn.cursor()
    cur.execute("""
        SELECT id, api_key, secret_key, type,
               COALESCE(allow_shorting, FALSE) AS allow_shorting,
               COALESCE(CAST(max_position_size AS FLOAT), 0.40) AS max_position_size,
               COALESCE(account_type_display, 'CASH') AS account_type_display,
               COALESCE(cash_mode, 'SETTLED') AS cash_mode
        FROM accounts
    """)
    rows = cur.fetchall()
    cur.close()
    print("WARNING: Using encrypted keys from database. Update API_BASE_URL to use decrypted credentials.")
    return rows


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


def get_position_or_none(api, symbol):
    try:
        return api.get_position(symbol)
    except Exception:
        return None


def _get_company_name(ticker):
    """Fetch company name from yfinance."""
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        return info.get('longName') or info.get('shortName') or ticker
    except Exception:
        return ticker


def run_analysis_cycle(model, conn, accounts):
    """Run one full analysis pass over DOW_30 and execute per-account."""
    _log_dir = os.path.join(os.path.dirname(__file__), "..", ".cursor")
    _log_path = os.path.join(_log_dir, "debug.log")
    for ticker in DOW_30:
        try:
            # region agent log
            try:
                os.makedirs(_log_dir, exist_ok=True)
                with open(_log_path, "a", encoding="utf-8") as _f:
                    _f.write(json.dumps({"location": "trade.py:run_analysis_cycle", "message": "before_yf_download", "data": {"ticker": ticker}, "timestamp": int(time.time() * 1000), "sessionId": "debug-session", "runId": "run1", "hypothesisId": "H5"}) + "\n")
            except Exception:
                pass
            # endregion
            data = yf.download(ticker, period="1mo", interval="1d", progress=False)
            df, err = sanitize_ohlcv(data)
            if err is not None:
                print(f"Skipping {ticker}: missing columns {err}")
                continue
            if len(df) < 15:
                print(f"Skipping {ticker}: insufficient data ({len(df)} rows)")
                continue
            df = df.reset_index(drop=True)

            def make_env():
                return GymnasiumWrapper(df)

            env = DummyVecEnv([make_env])
            raw = env.reset()
            obs = raw[0] if isinstance(raw, (list, tuple)) else raw
            if not isinstance(obs, np.ndarray):
                obs = np.array(obs)

            action, _ = model.predict(obs, deterministic=True)
            action_type = "BUY" if int(action[0]) == 1 else "SELL"

            close = df["Close"].iloc[-1]
            current_price = float(close.iloc[0] if isinstance(close, pd.Series) else close)
            print(f"  {ticker}: {action_type} @ ${current_price:.2f}")

            # Execute per account
            cur = conn.cursor()
            for acc in accounts:
                acc_id, api_key, secret_key, acc_type, allow_shorting, max_pos, acct_type_display, cash_mode = acc
                
                base_url = "https://paper-api.alpaca.markets" if str(acc_type).lower() == "paper" else "https://api.alpaca.markets"
                try:
                    api = tradeapi.REST(api_key, secret_key, base_url, api_version="v2")
                    acct = api.get_account()
                    raw_buying_power = float(acct.buying_power)
                    account_cash = float(acct.cash)
                    portfolio_value = float(acct.portfolio_value)
                except Exception as e:
                    print(f"    [{acc_id}] Alpaca error: {e}")
                    continue

                is_cash_account = acct_type_display != 'MARGIN'
                if not is_cash_account:
                    effective_buying_power = raw_buying_power
                elif cash_mode == 'SETTLED':
                    unsettled = 0.0
                    try:
                        today_et = datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d')
                        activities = api.get_activities(activity_types='FILL', date=today_et)
                        for act in (activities or []):
                            if getattr(act, 'side', '').lower() == 'sell':
                                unsettled += abs(float(getattr(act, 'qty', 0))) * float(getattr(act, 'price', 0))
                    except Exception:
                        pass
                    effective_buying_power = max(0.0, account_cash - unsettled)
                else:
                    effective_buying_power = account_cash

                max_trade_value = portfolio_value * max_pos
                trade_value = min(max_trade_value, effective_buying_power)
                qty = max(0, int(trade_value / current_price))
                if qty <= 0:
                    print(f"    [{acc_id}] Skipping {ticker}: no size (value={trade_value:.0f})")
                    continue

                pos = get_position_or_none(api, ticker)

                if action_type == "BUY":
                    if pos is not None:
                        side = str(pos.side).lower() if hasattr(pos, "side") else "long"
                        if side == "short":
                            close_qty = abs(int(float(pos.qty)))
                            api.submit_order(symbol=ticker, qty=close_qty, side="buy", type="market", time_in_force="gtc")
                            company_name = _get_company_name(ticker)
                            cur.execute(
                                "INSERT INTO trades (timestamp, ticker, action, price, quantity, strategy, pnl, account_id, company_name) VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                                (ticker, "BUY", current_price, close_qty, STRATEGY_NAME, 0.0, acc_id, company_name),
                            )
                            trade_id = cur.fetchone()[0]
                            
                            cur.execute("""
                                SELECT id, price, quantity 
                                FROM trades 
                                WHERE ticker = %s AND action = 'SELL' AND account_id = %s 
                                AND sell_trade_id IS NULL
                                ORDER BY timestamp DESC LIMIT 1
                            """, (ticker, acc_id))
                            buy_trade_row = cur.fetchone()
                            
                            if buy_trade_row:
                                sell_trade_id, sell_price, sell_qty = buy_trade_row
                                pnl = (sell_price - current_price) * min(close_qty, sell_qty)
                                cur.execute("""
                                    UPDATE trades SET pnl = %s, sell_trade_id = %s WHERE id = %s
                                """, (pnl, trade_id, sell_trade_id))
                            
                            conn.commit()
                            print(f"    [{acc_id}] Covered short {ticker} x {close_qty}")
                        else:
                            print(f"    [{acc_id}] Already long {ticker}, skip")
                    else:
                        api.submit_order(symbol=ticker, qty=qty, side="buy", type="market", time_in_force="gtc")
                        company_name = _get_company_name(ticker)
                        cur.execute(
                            "INSERT INTO trades (timestamp, ticker, action, price, quantity, strategy, pnl, account_id, company_name) VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                            (ticker, "BUY", current_price, qty, STRATEGY_NAME, 0.0, acc_id, company_name),
                        )
                        conn.commit()
                        print(f"    [{acc_id}] BUY {ticker} x {qty}")

                else:
                    # SELL
                    if pos is not None:
                        side = str(pos.side).lower() if hasattr(pos, "side") else "long"
                        if side == "long":
                            close_qty = int(float(pos.qty))
                            api.submit_order(symbol=ticker, qty=close_qty, side="sell", type="market", time_in_force="gtc")
                            company_name = _get_company_name(ticker)
                            cur.execute(
                                "INSERT INTO trades (timestamp, ticker, action, price, quantity, strategy, pnl, account_id, company_name) VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                                (ticker, "SELL", current_price, close_qty, STRATEGY_NAME, 0.0, acc_id, company_name),
                            )
                            sell_trade_id = cur.fetchone()[0]
                            
                            cur.execute("""
                                SELECT id, price, quantity
                                FROM trades 
                                WHERE ticker = %s AND action = 'BUY' AND account_id = %s 
                                AND sell_trade_id IS NULL
                                ORDER BY timestamp DESC LIMIT 1
                            """, (ticker, acc_id))
                            buy_trade_row = cur.fetchone()
                            
                            if buy_trade_row:
                                buy_trade_id, buy_price, buy_qty = buy_trade_row
                                pnl = (current_price - buy_price) * min(close_qty, buy_qty)
                                cur.execute("""
                                    UPDATE trades SET pnl = %s, sell_trade_id = %s WHERE id = %s
                                """, (pnl, sell_trade_id, buy_trade_id))
                            
                            conn.commit()
                            print(f"    [{acc_id}] Closed long {ticker} x {close_qty}")
                        else:
                            print(f"    [{acc_id}] Already short {ticker}, skip")
                    else:
                        if allow_shorting:
                            api.submit_order(symbol=ticker, qty=qty, side="sell", type="market", time_in_force="gtc")
                            company_name = _get_company_name(ticker)
                            cur.execute(
                                "INSERT INTO trades (timestamp, ticker, action, price, quantity, strategy, pnl, account_id, company_name) VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                                (ticker, "SELL", current_price, qty, STRATEGY_NAME, 0.0, acc_id, company_name),
                            )
                            conn.commit()
                            print(f"    [{acc_id}] SHORT {ticker} x {qty}")
                        else:
                            print(f"    [{acc_id}] SELL signal but no position; shorting disabled, stay cash")

            cur.close()
        except Exception as e:
            # region agent log
            try:
                _msg = str(e).lower()
                with open(_log_path, "a", encoding="utf-8") as _f:
                    _f.write(json.dumps({"location": "trade.py:run_analysis_cycle", "message": "yf_download_exception", "data": {"ticker": ticker, "exc_type": type(e).__name__, "exc_msg": str(e)[:300], "is_timeout": "timeout" in _msg or "curl: (28)" in _msg, "is_conn": "connection" in _msg or "broken pipe" in _msg or "curl: (56)" in _msg or "curl: (55)" in _msg}, "timestamp": int(time.time() * 1000), "sessionId": "debug-session", "runId": "run1", "hypothesisId": "H5"}) + "\n")
            except Exception:
                pass
            # endregion
            debug_log("run_analysis_cycle", str(e), {"ticker": ticker})
            print(f"Skipping {ticker}: {e}")


def get_clock_from_first_account(accounts):
    """Use first account's Alpaca API to fetch market clock."""
    if not accounts:
        return None
    acc = accounts[0]
    _, api_key, secret_key, acc_type = acc[0], acc[1], acc[2], acc[3]
    base_url = "https://paper-api.alpaca.markets" if str(acc_type).lower() == "paper" else "https://api.alpaca.markets"
    try:
        api = tradeapi.REST(api_key, secret_key, base_url, api_version="v2")
        return api.get_clock()
    except Exception:
        return None


def sleep_until_next_open(clock):
    """Sleep until 9:30 AM ET next trading day (use Alpaca next_open)."""
    now = clock.timestamp
    next_open = clock.next_open
    delta = next_open - now
    secs = max(1, int(delta.total_seconds()))
    print(f"Market closed. Sleeping until next open ({next_open}) ({secs}s)")
    time.sleep(secs)


def main():
    print("Swing Trading Bot Daemon starting. Stop with Ctrl+C.")
    
    # Load model using model manager
    model = get_latest_model(NEON_DATABASE_URL)
    if model is None:
        # Fallback to default path
        if os.path.isfile(MODEL_PATH):
            print(f"Loading default model from {MODEL_PATH}")
            model = PPO.load(MODEL_PATH)
        else:
            print(f"Model not found: {MODEL_PATH}. Run train.py first.")
            sys.exit(1)
    
    print("Model loaded.")
    last_model_reload = time.time()

    while True:
        conn = None
        try:
            conn = get_db()
            accounts = fetch_accounts(conn)

            if not accounts:
                print("No accounts in DB. Retrying in 60s.")
                time.sleep(ANALYSIS_INTERVAL_SEC)
                continue

            clock = get_clock_from_first_account(accounts)
            if clock is None:
                print("Could not fetch market clock. Retrying in 60s.")
                time.sleep(ANALYSIS_INTERVAL_SEC)
                continue

            if not clock.is_open:
                sleep_until_next_open(clock)
                continue

            # Check if we should reload model (every hour)
            current_time = time.time()
            if current_time - last_model_reload >= MODEL_RELOAD_INTERVAL:
                new_model = get_latest_model(NEON_DATABASE_URL)
                if new_model is not None:
                    model = new_model
                    last_model_reload = current_time
                    print("Model reloaded (new version available)")
            
            print(f"--- Cycle @ {time.ctime()} ---")
            run_analysis_cycle(model, conn, accounts)
            time.sleep(ANALYSIS_INTERVAL_SEC)
        except KeyboardInterrupt:
            print("\nShutting down.")
            break
        except Exception as e:
            debug_log("daemon", str(e), {})
            print(f"Cycle error: {e}. Retrying in 60s.")
            time.sleep(ANALYSIS_INTERVAL_SEC)
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass


if __name__ == "__main__":
    main()
