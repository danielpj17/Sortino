# Heartbeat setup walkthrough

Follow these steps in order to get the trading bot running with cron-job.org.

---

## Step 1: Run the database migration

You need the `bot_state` table in your **Neon** database.

1. Open your Neon project and go to the **SQL Editor**.
2. Run the migration. Either:
   - Run your full `schema.sql`, or  
   - Run only the `bot_state` part:

```sql
CREATE TABLE IF NOT EXISTS bot_state (
    id SERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    is_running BOOLEAN DEFAULT FALSE,
    always_on BOOLEAN DEFAULT FALSE,
    last_heartbeat TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_state_running ON bot_state(is_running);
CREATE INDEX IF NOT EXISTS idx_bot_state_always_on ON bot_state(always_on);
CREATE INDEX IF NOT EXISTS idx_bot_state_account_id ON bot_state(account_id);
```

3. Confirm the `accounts` table exists and has Alpaca credentials (`api_key`, `secret_key`, `type`, etc.). The bot reads from `accounts`.

---

## Step 2: Train the model (if you haven’t already)

1. Open a terminal in the project folder.
2. `cd python_engine`
3. `pip install -r requirements.txt`
4. `python train.py`
5. Ensure `dow30_model.zip` is created in `python_engine/`.

---

## Step 3: Deploy the Python Model API

The Vercel app calls a **separate** Python service for predictions. Deploy it (e.g. **Render**).

### Option A: Render (free tier)

1. Go to [render.com](https://render.com) and sign in.
2. **New** → **Web Service**.
3. Connect the **same GitHub repo** as your Sortino app.
4. **Root Directory:** `python_engine` (so Render uses `model_api.py` and `requirements.txt` there).
5. **Build Command:** `pip install -r requirements.txt`
6. **Start Command:** `python model_api.py`
7. **Environment variables:**
   - `DATABASE_URL` = your Neon connection string (same as Vercel).
   - `PORT` = leave empty; Render sets it.
8. Create the service. Note the URL, e.g. `https://sortino-model-api.onrender.com`.

### Option B: Run locally (for testing only)

- `cd python_engine` → `python model_api.py`
- It runs on `http://localhost:5000`. Use that as `MODEL_API_URL` when testing locally.

---

## Step 4: Set Vercel environment variables

1. Open your **Vercel** project → **Settings** → **Environment Variables**.
2. Add:
   - `DATABASE_URL` = your Neon connection string (you may already have this).
   - `MODEL_API_URL` = base URL of the Model API **with no trailing slash**, e.g.  
     `https://sortino-model-api.onrender.com`
3. Redeploy the app so the new variables are used.

---

## Step 5: Deploy the Sortino app to Vercel

1. Push your code to GitHub (if you use Git).
2. In Vercel, trigger a **Deploy** (or rely on auto-deploy).
3. Note your production URL, e.g. `https://sortino.vercel.app`.

---

## Step 6: Create the cron job on cron-job.org

1. Go to [cron-job.org](https://cron-job.org) and sign in.
2. Click **Create cronjob**.
3. **Title:** e.g. `Sortino Heartbeat`.
4. **URL:**  
   `https://sortino.vercel.app/api/trading/health-check`  
   (replace with your actual Vercel URL).
5. **Schedule:**
   - Choose **Every 2 minutes** (or **Every minute** if you prefer).
   - Or use cron: `*/2 * * * *` for every 2 minutes.
6. **Request method:** `GET`.
7. **Timezone:** `America/Denver` (Utah).
8. **Advanced (if available):**
   - **Request timeout:** 60–90 seconds.
   - **Notify on failure:** optional.
9. **Save** the cronjob.

---

## Step 7: Test the flow

1. **Model API**
   - Open `https://your-model-api.onrender.com/health` in a browser.  
   - You should see something like `{"status":"ok","model_loaded":true}`.

2. **Health-check (no bots)**
   - Open `https://sortino.vercel.app/api/trading/health-check`.  
   - You should see `{"status":"ok","message":"No active bots","bots_processed":0}`.

3. **Start the bot**
   - Go to **Paper Trading** or **Live Trading**.
   - Choose an **account** from the dropdown (don’t use “All Accounts”).
   - Click **START BOT**.  
   - The button should switch to **STOP BOT** and the bot runs one loop immediately.

4. **Cron heartbeat**
   - Wait for the next cron run (within 1–2 minutes).
   - Check health-check again or look at **Vercel** → **Logs** for the `/api/trading/health-check` runs.
   - With at least one active bot, you should see `bots_processed: 1` (or more) in the response.

5. **Stop the bot**
   - Click **STOP BOT**. The cron will continue to ping, but no trading loop will run because there are no active bots.

---

## Checklist

- [ ] Neon: `bot_state` migration run.
- [ ] `dow30_model.zip` exists; Model API runs (Render or local).
- [ ] Vercel: `DATABASE_URL` and `MODEL_API_URL` set.
- [ ] Sortino app deployed on Vercel.
- [ ] Cron job on cron-job.org hitting `/api/trading/health-check` every 1–2 minutes.
- [ ] At least one Alpaca account in `accounts` with valid `api_key` / `secret_key`.
- [ ] Start Bot works; health-check shows `bots_processed > 0` when bot is running.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| Health-check 500 | Vercel logs; `DATABASE_URL` and `MODEL_API_URL`; Neon connectivity. |
| “No active bots” | Start the bot from the UI (select account → Start Bot). |
| Model API 503 | Model API logs; `dow30_model.zip` present; `DATABASE_URL` if it loads from DB. |
| Cron timeout | Increase timeout to 90s; ensure Model API and Alpaca respond quickly. |
| Trades not executing | Alpaca keys correct; account has buying power; market open (7:30 AM–2:00 PM MDT). |

Market hours (MDT): **7:30 AM–2:00 PM**. Outside that window, the loop no-ops but still updates `last_heartbeat`.
