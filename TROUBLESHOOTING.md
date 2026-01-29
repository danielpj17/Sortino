# Troubleshooting: Bot Running But No Trades

## Run Diagnostics First

**Hit the diagnostics endpoint** to quickly identify the failure point:

```
GET https://YOUR_VERCEL_APP.vercel.app/api/trading/diagnostics
```

This returns:
- `db` – Database connection status
- `accounts` – Count of accounts in database
- `bots` – Active bot count, last_heartbeat, last_error
- `market` – Whether market is open (9:30 AM–4:00 PM ET, Mon–Fri)
- `model_api` – Model API reachability and model_loaded status
- `issues` – List of detected problems
- `next_steps` – Recommended fixes

Fix the issues listed, then redeploy and try again.

---

## Quick Checklist

### ✅ Bot Status: RUNNING
Your bot status shows it's running, which is good! But trades require several components to work together.

## Required Components for Trades

### 1. **Model API Service** (CRITICAL)
The bot needs a separate Python service running to get trading predictions.

**Check if it's set up:**
- Go to Vercel Dashboard → Your Project → Settings → Environment Variables
- Look for `MODEL_API_URL` 
- If it's missing or points to `http://localhost:5000`, you need to deploy the Model API

**To deploy Model API:**
1. Deploy `python_engine/model_api.py` to Render, Railway, or similar
2. Set `MODEL_API_URL` in Vercel to your deployed service URL (e.g., `https://your-model-api.onrender.com`)
3. Make sure the Model API has `DATABASE_URL` set and can access your model file

**Test the Model API:**
```bash
curl https://your-model-api-url/health
# Should return: {"status": "ok", "model_loaded": true}
```

### 2. **Market Hours**
The bot only trades during market hours:
- **ET:** 9:30 AM - 4:00 PM (Monday-Friday)
- **MDT/MST (Utah):** 7:30 AM - 2:00 PM (Monday-Friday)

**Current time check:**
- If it's outside market hours, the bot will skip trading and just update heartbeat
- If it's a weekend, no trades will execute

### 3. **Account Configuration**
Your account needs:
- ✅ Valid Alpaca API keys (`api_key` and `secret_key` in `accounts` table)
- ✅ Account type set correctly (`Paper` or `Live`)
- ✅ Sufficient buying power (for Paper: $100,000 default)

**Check your account:**
```sql
SELECT id, name, type, api_key IS NOT NULL as has_api_key 
FROM accounts 
WHERE id = 'your-account-id';
```

### 4. **Model File**
The Model API needs the trained model file:
- `python_engine/dow30_model.zip` should exist
- Or the model should be in the database (via `model_versions` table)

**To train the model:**
```bash
cd python_engine
pip install -r requirements.txt
python train.py
```

### 5. **Decision Smoothing (Why No Trades Even When Model Says BUY/SELL)**
The bot uses a smoothing layer: it only executes BUY/SELL when the rolling average probability exceeds **0.55**. If the model returns borderline predictions (e.g. 0.50 buy, 0.50 sell), the result is **HOLD** and no trade executes. It may take several cron cycles (10–20 minutes) before a trade is executed.

### 6. **Cron Not Running**
The health-check must be pinged every 1–2 minutes. If cron-job.org (or your cron) isn't set up or fails, the trading loop never runs.
- Set up cron-job.org to hit: `https://YOUR_APP.vercel.app/api/trading?health-check=true`
- Schedule: every 1–2 minutes

## Debugging Steps

### Step 1: Check Vercel Logs
1. Go to Vercel Dashboard → Your Project → Deployments → Latest
2. Click "Functions" tab
3. Look for `/api/trading` function logs
4. Check for errors like:
   - `Model API 503` - Model API not accessible
   - `Account not found` - Account ID issue
   - `Alpaca error` - API key issue

### Step 2: Test Model API Directly
```bash
# Test health endpoint
curl https://your-model-api-url/health

# Test prediction endpoint
curl -X POST https://your-model-api-url/predict \
  -H "Content-Type: application/json" \
  -d '{"ticker": "AAPL", "period": "1mo"}'
```

### Step 3: Check Market Hours
The bot logs will show:
- `skipped: true, reason: 'market_closed'` if market is closed
- This is normal outside trading hours

### Step 4: Manually Trigger a Trading Loop
You can manually trigger a trading cycle by calling:
```bash
curl -X POST https://your-app.vercel.app/api/trading \
  -H "Content-Type: application/json" \
  -d '{"account_id": "your-account-id", "action": "start"}'
```

Check the response and Vercel logs for any errors.

## Common Issues

### Issue: "Model API 503" or "no_prediction"
**Solution:** 
- Deploy the Model API service
- Set `MODEL_API_URL` in Vercel environment variables
- Ensure Model API has the model file loaded

### Issue: "Account not found"
**Solution:**
- Check that the account_id matches what's in your database
- Verify the account exists: `SELECT * FROM accounts WHERE id = 'your-id';`

### Issue: "Alpaca error" or "no_size"
**Solution:**
- Verify Alpaca API keys are correct
- Check account has buying power
- For Paper accounts, ensure you're using paper API keys

### Issue: Bot shows "RUNNING" but no trades
**Most likely causes:**
1. **Model API not deployed/configured** (most common)
2. **Market is closed** (check current time)
3. **Model not making BUY/SELL predictions** (model might be conservative)

## Next Steps

1. **Deploy Model API** (if not done):
   - Follow `HEARTBEAT_SETUP.md` Step 3
   - Deploy to Render/Railway
   - Set `MODEL_API_URL` in Vercel

2. **Check during market hours:**
   - Wait for next trading day (Monday-Friday, 7:30 AM - 2:00 PM MDT)
   - Or manually trigger a loop to test

3. **Monitor logs:**
   - Watch Vercel function logs during a trading cycle
   - Look for specific error messages

4. **Verify account setup:**
   - Ensure Alpaca API keys are valid
   - Check account has sufficient funds/buying power

## Still Not Working?

Check the detailed setup guide: `HEARTBEAT_SETUP.md`
