/**
 * Diagnostics endpoint: identify why trades aren't executing.
 * GET /api/trading/diagnostics
 * Returns: db, accounts, bots, market, model_api, issues, next_steps
 */

import { getPool } from '../db.js';
import { isMarketOpen } from './loop.js';

const MODEL_API_URL = process.env.MODEL_API_URL || 'http://localhost:5000';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const issues = [];
  const nextSteps = [];
  const diag = {
    timestamp: new Date().toISOString(),
    et_time: new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false }),
    weekday: new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' }),
    db: null,
    accounts: null,
    bots: null,
    market: null,
    model_api: null,
    issues,
    next_steps: nextSteps,
  };

  try {
    // 1. Database
    const pool = getPool();
    await pool.query('SELECT 1');
    diag.db = { ok: true };
  } catch (e) {
    diag.db = { ok: false, error: e.message };
    issues.push('Database connection failed');
    nextSteps.push('Check DATABASE_URL in Vercel environment variables');
    return res.status(200).json(diag);
  }

  const pool = getPool();

  // 2. Accounts
  try {
    const accRes = await pool.query('SELECT id, name, type FROM accounts');
    diag.accounts = { count: accRes.rows.length, ids: accRes.rows.map((r) => r.id) };
    if (accRes.rows.length === 0) {
      issues.push('No accounts in database');
      nextSteps.push('Add an Alpaca account in Settings');
    }
  } catch (e) {
    diag.accounts = { error: e.message };
    issues.push('Could not fetch accounts');
  }

  // 3. Active bots
  try {
    const botRes = await pool.query(
      `SELECT bs.account_id, bs.is_running, bs.always_on, bs.last_heartbeat, bs.last_error
       FROM bot_state bs
       INNER JOIN accounts a ON bs.account_id = a.id
       WHERE bs.is_running = TRUE OR bs.always_on = TRUE`
    );
    diag.bots = {
      active_count: botRes.rows.length,
      accounts: botRes.rows.map((r) => ({
        account_id: r.account_id,
        last_heartbeat: r.last_heartbeat?.toISOString?.() ?? null,
        last_error: r.last_error ?? null,
      })),
    };
    if (botRes.rows.length === 0) {
      issues.push('No active bots (is_running or always_on)');
      nextSteps.push('Start the bot: POST /api/trading with { account_id: 1, action: "start" }');
    }
    if (botRes.rows.some((r) => r.last_error)) {
      issues.push('One or more bots have last_error set');
      nextSteps.push('Check last_error in bot_state; fix the underlying issue');
    }
  } catch (e) {
    if (e.message?.includes('relation "bot_state" does not exist')) {
      diag.bots = { error: 'bot_state table missing' };
      issues.push('bot_state table does not exist');
      nextSteps.push('Run the bot_state schema in Neon SQL Editor. See HEARTBEAT_SETUP.md');
    } else {
      diag.bots = { error: e.message };
    }
  }

  // 4. Market hours (9:30 AM - 4:00 PM ET, Mon-Fri)
  const marketOpen = isMarketOpen();
  diag.market = {
    open: marketOpen,
    hours: '9:30 AM - 4:00 PM ET, Mon-Fri',
  };
  if (!marketOpen) {
    issues.push('Market is closed');
    nextSteps.push('Trading only runs during market hours. Wait until 9:30 AM ET on a weekday.');
  }

  // 5. Model API
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const modelRes = await fetch(`${MODEL_API_URL.replace(/\/$/, '')}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const modelData = await modelRes.json().catch(() => ({}));
    diag.model_api = {
      url: MODEL_API_URL,
      reachable: modelRes.ok,
      status: modelRes.status,
      model_loaded: modelData.model_loaded ?? null,
    };
    if (!modelRes.ok) {
      issues.push('Model API returned non-OK status');
      nextSteps.push('Check Model API logs on Render/Railway. Ensure MODEL_API_URL is correct in Vercel.');
    }
    if (modelData.model_loaded === false) {
      issues.push('Model API reports model not loaded');
      nextSteps.push('Ensure dow30_model.zip exists in python_engine and is deployed.');
    }
    if (MODEL_API_URL.includes('localhost')) {
      issues.push('MODEL_API_URL points to localhost (will not work on Vercel)');
      nextSteps.push('Set MODEL_API_URL in Vercel to your deployed Model API URL (e.g. https://xxx.onrender.com)');
    }
  } catch (e) {
    diag.model_api = {
      url: MODEL_API_URL,
      reachable: false,
      error: e.message,
      is_timeout: e.name === 'AbortError',
    };
    issues.push('Model API unreachable');
    nextSteps.push(
      MODEL_API_URL.includes('localhost')
        ? 'Set MODEL_API_URL in Vercel to your deployed Model API URL'
        : 'Verify Model API is running and MODEL_API_URL is correct. Check Render/Railway logs.'
    );
  }

  // 6. Cron
  diag.cron = {
    hint: 'Cron must hit /api/trading?health-check=true or /api/trading/health-check every 1-2 min',
    url_example: 'https://YOUR_VERCEL_APP.vercel.app/api/trading?health-check=true',
  };
  if (diag.bots?.active_count > 0 && diag.bots.accounts?.every((a) => !a.last_heartbeat)) {
    issues.push('Bots are active but last_heartbeat is null - cron may not be running');
    nextSteps.push('Set up cron-job.org to hit the health-check URL every 1-2 minutes');
  }

  return res.status(200).json(diag);
}
