/**
 * Trading loop: one "tick" of the Heartbeat architecture.
 * Fetches predictions from Model API, executes via Alpaca, stores trades in Neon.
 */

import { getPool } from '../db.js';
import { getDecryptedAccount } from '../account-credentials.js';

const DOW_30 = [
  'AXP', 'AMGN', 'AAPL', 'BA', 'CAT', 'CSCO', 'CVX', 'GS', 'HD', 'HON',
  'IBM', 'INTC', 'JNJ', 'KO', 'JPM', 'MCD', 'MMM', 'MRK', 'MSFT', 'NKE',
  'PG', 'TRV', 'UNH', 'CRM', 'VZ', 'V', 'WMT', 'DIS', 'DOW',
];

const STRATEGY_NAME = 'Dow30-Swing-Sortino';
const MODEL_API_URL = process.env.MODEL_API_URL || 'http://localhost:5000';

// #region agent log
fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:16',message:'MODEL_API_URL initialized',data:{modelApiUrl:MODEL_API_URL,envVarSet:!!process.env.MODEL_API_URL,isLocalhost:MODEL_API_URL.includes('localhost')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
// #endregion

// Warn if MODEL_API_URL is not configured (will fail on Vercel)
if (!process.env.MODEL_API_URL || MODEL_API_URL.includes('localhost')) {
  console.warn('[trading] WARNING: MODEL_API_URL not configured or using localhost. Model predictions will fail on Vercel.');
  console.warn('[trading] Set MODEL_API_URL in Vercel environment variables to your deployed Model API URL.');
}

/**
 * Market hours: 9:30 AM - 4:00 PM ET (Eastern Time).
 * Uses proper timezone conversion to handle EST (UTC-5) and EDT (UTC-4) automatically.
 */
function isMarketOpen() {
  const now = new Date();
  
  // Get all ET time components using Intl API (handles DST automatically)
  const etDateString = now.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short'
  });
  
  // Parse: "Mon, 01/26/2026, 13:45:00"
  const parts = etDateString.split(', ');
  const weekday = parts[0]; // "Mon", "Tue", etc.
  const datePart = parts[1]; // "01/26/2026"
  const timePart = parts[2]; // "13:45:00"
  
  const [month, day, year] = datePart.split('/');
  const [hour, minute] = timePart.split(':');
  
  const hourNum = parseInt(hour, 10);
  const minuteNum = parseInt(minute, 10);

  // Market is closed on weekends
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  
  // Market hours: 9:30 AM - 4:00 PM ET
  if (hourNum < 9) return false;
  if (hourNum === 9 && minuteNum < 30) return false;
  if (hourNum >= 16) return false;
  
  return true;
}

async function getModelPrediction(ticker) {
  const requestUrl = `${MODEL_API_URL}/predict`;
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:67',message:'Model API request start',data:{ticker,modelApiUrl:MODEL_API_URL,requestUrl,envVarSet:!!process.env.MODEL_API_URL},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  try {
    // Add timeout to prevent hanging (10 seconds max per prediction)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const startTime = Date.now();
    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, period: '1mo' }),
      signal: controller.signal,
    });
    const duration = Date.now() - startTime;
    
    clearTimeout(timeoutId);
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:85',message:'Model API response received',data:{ticker,status:res.status,ok:res.ok,statusText:res.statusText,durationMs:duration},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:90',message:'Model API non-OK response',data:{ticker,status:res.status,statusText:res.statusText,errorText},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      throw new Error(`Model API ${res.status}: ${errorText || res.statusText}`);
    }
    
    const data = await res.json();
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:95',message:'Model API data parsed successfully',data:{ticker,hasData:!!data,hasError:!!data?.error,action:data?.action,actionCode:data?.action_code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return data;
  } catch (e) {
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:100',message:'Model API error caught',data:{ticker,errorName:e.name,errorMessage:e.message,errorStack:e.stack?.substring(0,200),modelApiUrl:MODEL_API_URL,requestUrl,isTimeout:e.name==='AbortError',isNetworkError:e.message?.includes('fetch')||e.message?.includes('network')||e.message?.includes('ECONNREFUSED')||e.message?.includes('ENOTFOUND')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    if (e.name === 'AbortError') {
      console.error(`Model prediction ${ticker}: Timeout after 10 seconds`);
    } else {
      console.error(`Model prediction ${ticker}:`, e.message);
    }
    return null;
  }
}

async function alpacaFetch(baseUrl, path, { method = 'GET', body } = {}, headers = {}) {
  const url = `${baseUrl}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body && (method === 'POST' || method === 'PUT')) opts.body = JSON.stringify(body);
  
  // Add timeout to prevent hanging (5 seconds max per Alpaca API call)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  opts.signal = controller.signal;
  
  try {
    const res = await fetch(url, opts);
    clearTimeout(timeoutId);
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw new Error(`Alpaca API timeout after 5 seconds: ${path}`);
    }
    throw e;
  }
}

async function getAccount(apiKey, secretKey, baseUrl) {
  return alpacaFetch(baseUrl, '/v2/account', {}, {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': secretKey,
  });
}

async function getPosition(apiKey, secretKey, baseUrl, symbol) {
  try {
    return await alpacaFetch(baseUrl, `/v2/positions/${symbol}`, {}, {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': secretKey,
    });
  } catch {
    return null;
  }
}

async function submitOrder(apiKey, secretKey, baseUrl, { symbol, qty, side, type = 'market', time_in_force = 'gtc' }) {
  return alpacaFetch(baseUrl, '/v2/orders', {
    method: 'POST',
    body: { symbol, qty, side, type, time_in_force },
  }, {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': secretKey,
  });
}

async function insertTrade(pool, { ticker, action, price, quantity, account_id, company_name = ticker }) {
  await pool.query(
    `INSERT INTO trades (ticker, action, price, quantity, strategy, pnl, account_id, company_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [ticker, action, price, quantity, STRATEGY_NAME, 0.0, account_id, company_name]
  );
}

/**
 * Execute one full trading loop for a single account.
 * Skips execution if market is closed (MDT: 7:30 AM–2:00 PM).
 * @param {number} accountId
 * @returns {{ success: boolean, results?: object[], error?: string }}
 */
export async function executeTradingLoop(accountId) {
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:111',message:'Trading loop entry',data:{accountId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
  // #endregion
  
  const marketOpen = isMarketOpen();
  // Get current ET time for logging
  const etTimeString = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short'
  });
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:114',message:'Market hours check',data:{accountId,marketOpen,now:new Date().toISOString(),etTime:etTimeString},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  if (!marketOpen) {
    const pool = getPool();
    try {
      await pool.query(
        `UPDATE bot_state 
         SET last_heartbeat = NOW(), updated_at = NOW() 
         WHERE account_id = $1 
         AND account_id IN (SELECT id FROM accounts)`,
        [accountId]
      );
    } catch (e) {
      // If update fails due to foreign key constraint, account may have been deleted
      // Log but don't throw - this is handled by the caller
      console.warn(`[loop] Could not update heartbeat for account ${accountId}:`, e.message);
    }
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:127',message:'Trading loop skipped: market closed',data:{accountId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return { success: true, results: [], skipped: true, reason: 'market_closed' };
  }

  const pool = getPool();

  // Get account with decrypted credentials
  const acc = await getDecryptedAccount(accountId);
  const baseUrl = String(acc.type).toLowerCase() === 'paper'
    ? 'https://paper-api.alpaca.markets'
    : 'https://api.alpaca.markets';

  let account;
  try {
    account = await getAccount(acc.api_key, acc.secret_key, baseUrl);
  } catch (e) {
    try {
      await pool.query(
        `UPDATE bot_state 
         SET last_error = $1, updated_at = NOW() 
         WHERE account_id = $2 
         AND account_id IN (SELECT id FROM accounts)`,
        [e.message, accountId]
      );
    } catch (updateErr) {
      // If update fails, log but don't throw - the original error is more important
      console.warn(`[loop] Could not update error state for account ${accountId}:`, updateErr.message);
    }
    throw e;
  }

  const buyingPower = parseFloat(account.buying_power) || 0;
  const portfolioValue = parseFloat(account.portfolio_value) || 0;
  const maxTradeValue = portfolioValue * (acc.max_position_size || 0.4);
  const tradeValue = Math.min(maxTradeValue, buyingPower);
  const allowShorting = !!acc.allow_shorting;

  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:157',message:'Account financials',data:{accountId,buyingPower,portfolioValue,maxPositionSize:acc.max_position_size||0.4,maxTradeValue,tradeValue,allowShorting},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion

  const results = [];

  // Process tickers in batches to avoid timeout
  // Use time-based rotation if metadata column doesn't exist
  const BATCH_SIZE = 10; // Process 10 tickers per run (should complete in ~20-30 seconds with timeouts)
  let batchStart = 0;
  
  try {
    // Try to get batch position from metadata column
    const batchResult = await pool.query(
      `SELECT COALESCE((metadata->>'batch_start')::int, NULL) as batch_start
       FROM bot_state 
       WHERE account_id = $1`,
      [accountId]
    );
    if (batchResult.rows.length > 0 && batchResult.rows[0].batch_start !== null) {
      batchStart = batchResult.rows[0].batch_start;
    } else {
      // Fallback: use time-based rotation (changes every minute)
      // This ensures different tickers are processed over time even without metadata column
      const minutesSinceEpoch = Math.floor(Date.now() / 60000);
      batchStart = (minutesSinceEpoch * BATCH_SIZE) % DOW_30.length;
    }
  } catch (e) {
    // If metadata column doesn't exist or query fails, use time-based rotation
    const minutesSinceEpoch = Math.floor(Date.now() / 60000);
    batchStart = (minutesSinceEpoch * BATCH_SIZE) % DOW_30.length;
    console.warn(`[loop] Using time-based batch rotation for account ${accountId}:`, e.message);
  }

  const tickersToProcess = DOW_30.slice(batchStart, batchStart + BATCH_SIZE);
  const nextBatchStart = (batchStart + BATCH_SIZE) % DOW_30.length;
  
  // Safety check: if batch size calculation resulted in empty array, use first few tickers
  if (tickersToProcess.length === 0) {
    tickersToProcess.push(...DOW_30.slice(0, Math.min(BATCH_SIZE, DOW_30.length)));
  }

  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:195',message:'Starting ticker loop (batched)',data:{accountId,modelApiUrl:MODEL_API_URL,isLocalhost:MODEL_API_URL.includes('localhost'),totalTickers:DOW_30.length,batchStart,tickersInBatch:tickersToProcess.length,nextBatchStart},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion

  for (const ticker of tickersToProcess) {
    try {
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:168',message:'Fetching model prediction',data:{accountId,ticker},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      const pred = await getModelPrediction(ticker);
      
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:171',message:'Model prediction received',data:{accountId,ticker,hasPrediction:!!pred,error:pred?.error,action:pred?.action,actionCode:pred?.action_code,price:pred?.price,buyProb:pred?.buy_probability,sellProb:pred?.sell_probability,priceChange10d:pred?.price_change_10d_pct,volatility10d:pred?.volatility_10d,dataPoints:pred?.data_points,modelApiUrl:MODEL_API_URL},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      if (!pred || pred.error) {
        const reason = pred?.error ? `no_prediction: ${pred.error}` : (MODEL_API_URL === 'http://localhost:5000' ? 'no_prediction: MODEL_API_URL not configured' : 'no_prediction: API call failed');
        // #region agent log
        fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:177',message:'Model prediction failed',data:{accountId,ticker,reason,predError:pred?.error,modelApiUrl:MODEL_API_URL,isLocalhost:MODEL_API_URL.includes('localhost')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        results.push({ ticker, status: 'skip', reason: 'no_prediction' });
        continue;
      }

      // Store prediction in database for analysis (optional - table may not exist)
      try {
        await pool.query(
          `INSERT INTO model_predictions 
           (ticker, account_id, action_code, action_type, price, buy_probability, sell_probability, 
            price_change_10d_pct, volatility_10d, data_points)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            ticker,
            accountId,
            pred.action_code,
            pred.action,
            pred.price,
            pred.buy_probability || null,
            pred.sell_probability || null,
            pred.price_change_10d_pct || null,
            pred.volatility_10d || null,
            pred.data_points || null
          ]
        );
      } catch (predErr) {
        // If table doesn't exist or query fails, log but continue (don't crash)
        // This is optional functionality for analysis
        if (predErr.message && !predErr.message.includes('relation "model_predictions" does not exist')) {
          console.warn(`[loop] Could not store prediction for ${ticker}:`, predErr.message);
        }
        // Silently ignore if table doesn't exist - it's optional
      }

      const actionType = pred.action || (pred.action_code === 1 ? 'BUY' : 'SELL');
      const price = parseFloat(pred.price);
      if (!price || price <= 0) {
        results.push({ ticker, status: 'skip', reason: 'invalid_price' });
        continue;
      }

      const qty = Math.max(0, Math.floor(tradeValue / price));
      
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:183',message:'Trade size calculation',data:{accountId,ticker,actionType,price,tradeValue,qty},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      if (qty <= 0) {
        results.push({ ticker, status: 'skip', reason: 'no_size' });
        continue;
      }

      const pos = await getPosition(acc.api_key, acc.secret_key, baseUrl, ticker);
      const side = pos ? String(pos.side).toLowerCase() : null;
      
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:189',message:'Position check',data:{accountId,ticker,actionType,hasPosition:!!pos,side,qty,allowShorting},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion

      if (actionType === 'BUY') {
        if (pos) {
          if (side === 'short') {
            const closeQty = Math.abs(parseInt(pos.qty, 10));
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:192',message:'Executing: BUY to cover short',data:{accountId,ticker,qty:closeQty,price},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            await submitOrder(acc.api_key, acc.secret_key, baseUrl, {
              symbol: ticker,
              qty: closeQty,
              side: 'buy',
              type: 'market',
              time_in_force: 'gtc',
            });
            await insertTrade(pool, {
              ticker,
              action: 'BUY',
              price,
              quantity: closeQty,
              account_id: accountId,
            });
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:207',message:'Trade executed: covered short',data:{accountId,ticker,qty:closeQty},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            // Update prediction record with trade execution (optional - table may not exist)
            try {
              const tradeResult = await pool.query('SELECT id FROM trades WHERE ticker = $1 AND account_id = $2 ORDER BY timestamp DESC LIMIT 1', [ticker, accountId]);
              if (tradeResult.rows.length > 0) {
                await pool.query('UPDATE model_predictions SET was_executed = TRUE, trade_id = $1, skip_reason = NULL WHERE ticker = $2 AND account_id = $3 AND timestamp > NOW() - INTERVAL \'1 minute\' ORDER BY timestamp DESC LIMIT 1', [tradeResult.rows[0].id, ticker, accountId]);
              }
            } catch (updateErr) {
              // Silently ignore - table may not exist, this is optional
            }
            results.push({ ticker, action: 'BUY', qty: closeQty, status: 'covered_short' });
          } else {
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:209',message:'Skipped: already long',data:{accountId,ticker},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            // Update prediction record with skip reason (optional - table may not exist)
            try {
              await pool.query('UPDATE model_predictions SET skip_reason = $1 WHERE ticker = $2 AND account_id = $3 AND timestamp > NOW() - INTERVAL \'1 minute\' ORDER BY timestamp DESC LIMIT 1', ['already_long', ticker, accountId]);
            } catch (updateErr) {
              // Silently ignore - table may not exist, this is optional
            }
            results.push({ ticker, action: 'BUY', status: 'skip', reason: 'already_long' });
          }
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:212',message:'Executing: BUY new position',data:{accountId,ticker,qty,price},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          await submitOrder(acc.api_key, acc.secret_key, baseUrl, {
            symbol: ticker,
            qty,
            side: 'buy',
            type: 'market',
            time_in_force: 'gtc',
          });
          await insertTrade(pool, {
            ticker,
            action: 'BUY',
            price,
            quantity: qty,
            account_id: accountId,
          });
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:226',message:'Trade executed: BUY filled',data:{accountId,ticker,qty},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          // Update prediction record with trade execution (optional - table may not exist)
          try {
            const tradeResult = await pool.query('SELECT id FROM trades WHERE ticker = $1 AND account_id = $2 ORDER BY timestamp DESC LIMIT 1', [ticker, accountId]);
            if (tradeResult.rows.length > 0) {
              await pool.query('UPDATE model_predictions SET was_executed = TRUE, trade_id = $1, skip_reason = NULL WHERE ticker = $2 AND account_id = $3 AND timestamp > NOW() - INTERVAL \'1 minute\' ORDER BY timestamp DESC LIMIT 1', [tradeResult.rows[0].id, ticker, accountId]);
            }
          } catch (updateErr) {
            // Silently ignore - table may not exist, this is optional
          }
          results.push({ ticker, action: 'BUY', qty, status: 'filled' });
        }
      } else {
        if (pos) {
          if (side === 'long') {
            const closeQty = parseInt(pos.qty, 10);
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:231',message:'Executing: SELL to close long',data:{accountId,ticker,qty:closeQty,price},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            await submitOrder(acc.api_key, acc.secret_key, baseUrl, {
              symbol: ticker,
              qty: closeQty,
              side: 'sell',
              type: 'market',
              time_in_force: 'gtc',
            });
            await insertTrade(pool, {
              ticker,
              action: 'SELL',
              price,
              quantity: closeQty,
              account_id: accountId,
            });
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:246',message:'Trade executed: closed long',data:{accountId,ticker,qty:closeQty},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            results.push({ ticker, action: 'SELL', qty: closeQty, status: 'closed_long' });
          } else {
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:248',message:'Skipped: already short',data:{accountId,ticker},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            results.push({ ticker, action: 'SELL', status: 'skip', reason: 'already_short' });
          }
        } else {
          if (allowShorting) {
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:252',message:'Executing: SELL to open short',data:{accountId,ticker,qty,price},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            await submitOrder(acc.api_key, acc.secret_key, baseUrl, {
              symbol: ticker,
              qty,
              side: 'sell',
              type: 'market',
              time_in_force: 'gtc',
            });
            await insertTrade(pool, {
              ticker,
              action: 'SELL',
              price,
              quantity: qty,
              account_id: accountId,
            });
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:266',message:'Trade executed: short opened',data:{accountId,ticker,qty},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            results.push({ ticker, action: 'SELL', qty, status: 'short_opened' });
          } else {
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:268',message:'Skipped: SELL with no position, shorting disabled',data:{accountId,ticker,allowShorting},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            // Update prediction record with skip reason (optional - table may not exist)
            try {
              await pool.query('UPDATE model_predictions SET skip_reason = $1 WHERE ticker = $2 AND account_id = $3 AND timestamp > NOW() - INTERVAL \'1 minute\' ORDER BY timestamp DESC LIMIT 1', ['shorting_disabled', ticker, accountId]);
            } catch (updateErr) {
              // Silently ignore - table may not exist, this is optional
            }
            results.push({ ticker, action: 'SELL', status: 'skip', reason: 'shorting_disabled' });
          }
        }
      }
    } catch (e) {
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:273',message:'Trading loop error for ticker',data:{accountId,ticker,error:e.message,stack:e.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      console.error(`Trading loop ${ticker}:`, e);
      results.push({ ticker, status: 'error', error: e.message });
    }
  }
  
  // Calculate prediction statistics
  const predictionStats = {
    total: results.length,
    buy: results.filter(r => r.action === 'BUY').length,
    sell: results.filter(r => r.action === 'SELL').length,
    skipped: results.filter(r => r.status === 'skip').length,
    executed: results.filter(r => r.status !== 'skip' && r.status !== 'error').length,
    errors: results.filter(r => r.status === 'error').length,
    skipReasons: {}
  };
  results.forEach(r => {
    if (r.status === 'skip' && r.reason) {
      predictionStats.skipReasons[r.reason] = (predictionStats.skipReasons[r.reason] || 0) + 1;
    }
  });

  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:276',message:'Trading loop completed all tickers in batch',data:{accountId,resultsCount:results.length,results:results.map(r=>({ticker:r.ticker,status:r.status,reason:r.reason,action:r.action})),nextBatchStart,predictionStats},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion

  try {
    // Update bot_state with next batch start and heartbeat
    // Try to update with metadata column (if it exists)
    try {
      // First check if metadata column exists by attempting to update it
      await pool.query(
        `UPDATE bot_state 
         SET last_heartbeat = NOW(), 
             last_error = NULL, 
             updated_at = NOW(),
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('batch_start', $2)
         WHERE account_id = $1 
         AND account_id IN (SELECT id FROM accounts)`,
        [accountId, nextBatchStart]
      );
    } catch (metadataErr) {
      // If metadata column doesn't exist, update without it
      // Time-based rotation will still work
      await pool.query(
        `UPDATE bot_state 
         SET last_heartbeat = NOW(), 
             last_error = NULL, 
             updated_at = NOW()
         WHERE account_id = $1 
         AND account_id IN (SELECT id FROM accounts)`,
        [accountId]
      );
    }
  } catch (e) {
    // If update fails due to foreign key constraint, log but don't throw
    // The trading loop completed successfully, this is just a state update
    console.warn(`[loop] Could not update final heartbeat for account ${accountId}:`, e.message);
  }

  return { success: true, results, batchInfo: { processed: tickersToProcess.length, nextBatchStart, totalTickers: DOW_30.length } };
}

export { isMarketOpen };
