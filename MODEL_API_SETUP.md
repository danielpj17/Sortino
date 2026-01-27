# Model API Setup Guide

## Issue: "no_prediction" Errors

The trading bot is getting `"no_prediction"` errors because the Model API is not accessible. The code defaults to `http://localhost:5000`, which won't work on Vercel.

## Solution: Deploy Model API and Configure URL

### Step 1: Deploy the Python Model API

The Model API is a separate Python Flask service that needs to be deployed independently.

#### Option A: Deploy to Render (Recommended - Free Tier)

1. Go to [render.com](https://render.com) and sign in
2. Click **New** → **Web Service**
3. Connect your GitHub repository (same repo as your Sortino app)
4. Configure the service:
   - **Name**: `sortino-model-api` (or any name you prefer)
   - **Root Directory**: `python_engine` (important!)
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python model_api.py`
5. **Environment Variables** (found in the service settings):
   - After creating the service, go to your service dashboard
   - Click on the **Environment** tab (in the left sidebar)
   - Click **Add Environment Variable** button
   - Add:
     - **Key**: `DATABASE_URL`
     - **Value**: Your Neon PostgreSQL connection string (same as Vercel)
     - Click **Save Changes**
   - **Note**: You do NOT need to set `PORT` - Render automatically sets this and the code reads it from `os.getenv("PORT", 5000)`
6. Click **Create Web Service** (or if already created, the changes will auto-deploy)
7. Wait for deployment to complete
8. Note the service URL, e.g., `https://sortino-model-api.onrender.com`

#### Option B: Deploy to Railway

1. Go to [railway.app](https://railway.app) and sign in
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your repository
4. Add a new service → **GitHub Repo**
5. Set **Root Directory** to `python_engine`
6. Railway will auto-detect Python
7. Set environment variables:
   - `DATABASE_URL` = Your Neon PostgreSQL connection string
8. Deploy and note the URL

#### Option C: Deploy to Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. In `python_engine` directory, create `fly.toml`:
   ```toml
   app = "sortino-model-api"
   primary_region = "iad"
   
   [build]
   
   [http_service]
     internal_port = 5000
     force_https = true
     auto_stop_machines = true
     auto_start_machines = true
     min_machines_running = 0
   
   [[services]]
     protocol = "tcp"
     internal_port = 5000
   ```
3. Run: `fly launch`
4. Set secrets: `fly secrets set DATABASE_URL="your-neon-url"`

### Step 2: Verify Model API is Working

1. Open your Model API URL in a browser: `https://your-model-api.onrender.com/health`
2. You should see: `{"status":"ok","model_loaded":true}`
3. If you get **"Not Found"**:
   - Check Render logs (click **Logs** tab in your service dashboard)
   - Look for errors during startup
   - Verify the service status shows "Live" (green)
   - Try the root endpoint: `https://your-model-api.onrender.com/` (should show service info)
4. If `model_loaded` is `false`:
   - Check that `dow30_model.zip` exists in the `python_engine` directory
   - Verify the file is committed to your GitHub repository
   - Check Render logs for model loading errors

### Step 3: Set MODEL_API_URL in Vercel

**Your Model API URL**: `https://sortino.onrender.com`

1. Go to your Vercel project dashboard: https://vercel.com/dashboard
2. Select your Sortino project
3. Navigate to **Settings** → **Environment Variables**
4. Click **Add New**
5. Add:
   - **Key**: `MODEL_API_URL`
   - **Value**: `https://sortino.onrender.com`
   - **Important**: No trailing slash!
6. Select **Production**, **Preview**, and **Development** (or at least Production)
7. Click **Save**
8. **Redeploy** your Vercel app for the change to take effect:
   - Go to **Deployments** tab
   - Click the three dots (⋯) on the latest deployment
   - Click **Redeploy**
   - Wait for deployment to complete

### Step 4: Verify It's Working

1. After redeploy, trigger the health-check: `https://sortino.vercel.app/api/trading/health-check`
2. Check the response - you should see predictions instead of `"no_prediction"` errors
3. Check Vercel logs to see if Model API calls are succeeding

## Troubleshooting

### Getting "Not Found" when accessing /health

This usually means the Flask app isn't running. Check:

1. **Render Service Status**:
   - Go to your Render dashboard
   - Check if the service shows "Live" (green) or "Failed" (red)
   - If failed, check the **Logs** tab for errors

2. **Check Render Logs**:
   - Click on your service → **Logs** tab
   - Look for Python errors, import errors, or startup failures
   - Common issues:
     - Missing dependencies (check `requirements.txt`)
     - Model file not found (`dow30_model.zip` missing)
     - Database connection errors
     - Port binding errors

3. **Verify Start Command**:
   - Should be: `python model_api.py`
   - NOT: `flask run` or `gunicorn` (unless you configure it)

4. **Test Root Endpoint**:
   - Try: `https://your-api.onrender.com/` (root path)
   - Should return: `{"service": "Sortino Model API", "health": "/health", "predict": "POST /predict"}`
   - If this also returns "Not Found", the app isn't starting

5. **Check Build Logs**:
   - In Render, go to **Events** tab
   - Check if the build succeeded
   - Look for errors installing dependencies

### Model API returns 503 or "model not loaded"

- Check that `dow30_model.zip` exists in your `python_engine` directory
- Verify the model file is committed to your repository
- Check Model API logs for errors loading the model

### Model API returns 500 errors

- Check Model API logs for Python errors
- Verify `DATABASE_URL` is set correctly in Model API environment
- Check that all Python dependencies are installed (`requirements.txt`)

### Still getting "no_prediction" after setup

1. Verify `MODEL_API_URL` is set in Vercel (check environment variables)
2. Verify the URL is accessible (test in browser: `https://your-api.com/health`)
3. Check Vercel logs for connection errors or timeouts
4. Ensure you redeployed after setting the environment variable

### Model API is slow or timing out

- The trading loop has 10-second timeouts per prediction
- If Model API is consistently slow, consider:
  - Upgrading your hosting plan (Render free tier can be slow)
  - Using a faster hosting service
  - Optimizing the model loading

## Current Status

- ✅ Trading bot is running
- ✅ Market hours check is working
- ✅ Health-check endpoint is working
- ✅ Model API deployed and working at `https://sortino.onrender.com`
- ⚠️ **ACTION REQUIRED**: Set `MODEL_API_URL` in Vercel to `https://sortino.onrender.com` and redeploy
