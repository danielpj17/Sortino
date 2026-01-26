# Heartbeat cron setup (cron-job.org)

The trading bot uses a **Heartbeat** architecture: a cron job pings the health-check endpoint every 1–2 minutes. The endpoint finds all accounts with `is_running` or `always_on`, then runs one full trading loop for each.

## 1. Health-check URL

Use your deployed base URL:

- **Production:** `https://sortino.vercel.app/api/trading?health-check=true`
- **Preview/local:** Replace with your Vercel preview URL or `http://localhost:5173` + your dev API port if you run the API locally.

## 2. cron-job.org setup

1. Go to [cron-job.org](https://cron-job.org) and sign in.
2. **Create** → **Cronjob**.
3. **Title:** e.g. `Sortino Heartbeat`.
4. **URL:**  
   `https://sortino.vercel.app/api/trading?health-check=true`  
   (or your actual deployed URL).
5. **Schedule:**
   - **Interval:** every **2 minutes** (or 1 minute if you prefer).  
   - Cron expression examples:
     - Every 2 minutes: `*/2 * * * *`
     - Every 1 minute: `* * * * *`
6. **Request method:** `GET`.
7. **Timezone:** Your server/timezone (e.g. **America/Denver** for MDT/MST).  
   The *trading loop* uses MDT for market hours (7:30 AM–2:00 PM); the cron schedule is just “when to ping.” Use your local timezone so the schedule matches when you expect runs.
8. **Optional:**
   - **Request timeout:** 60–90 seconds (loop can take a bit).
   - **Failure notifications:** Enable if you want alerts when the cron run fails.
9. **Save** the cronjob.

## 3. Environment variables

- **Vercel (API):**  
  - `DATABASE_URL` (Neon)  
  - `MODEL_API_URL` = base URL of your **Model API** (Flask app), e.g.  
    `https://your-model-api.onrender.com`  
    (no trailing slash).

- **Model API (Flask):**  
  - `DATABASE_URL` (Neon)  
  - `PORT` (optional; Render/Railway set this).

## 4. Flow

1. cron-job.org sends **GET** to `/api/trading?health-check=true` every 1–2 minutes.
2. Health-check reads **Neon** `bot_state`: accounts with `is_running` or `always_on`.
3. For each such account, it runs **one** trading loop (DOW 30 scan → Model API predictions → Alpaca execution).
4. Market hours (MDT 7:30 AM–2:00 PM) are enforced inside the loop; outside that window the loop no-ops but still updates `last_heartbeat`.

## 5. Start / stop bot

- **Start (and run once immediately):**  
  `POST /api/trading`  
  Body: `{ "account_id": 1, "action": "start" }`  
  → Sets `is_running` and `always_on`, then runs one loop.

- **Stop:**  
  `POST /api/trading`  
  Body: `{ "account_id": 1, "action": "stop" }`  
  → Clears `is_running` and `always_on`.

- **Status:**  
  `GET /api/trading?account_id=1`  
  → `is_running`, `always_on`, `last_heartbeat`, `last_error`.

## 6. MDT / MST (Utah)

- Market hours: **9:30 AM–4:00 PM ET** = **7:30 AM–2:00 PM MDT** (and 6:30 AM–1:00 PM MST).
- The loop treats 7:30–14:00 **MDT** as “market open.”  
- Cron schedule can stay in **America/Denver**; no change needed for Utah.

## 7. Troubleshooting

- **Health-check returns 500:** Check Vercel logs, `DATABASE_URL`, and `MODEL_API_URL`.
- **“No active bots”:** Start the bot with `POST /api/trading` and `action: "start"` for the desired `account_id`.
- **Cron hits timeout:** Increase timeout to 90s; ensure Model API and Alpaca respond quickly.
- **Model API 503:** Ensure the Flask app is up and the model file exists (`dow30_model.zip` or latest versioned model).
