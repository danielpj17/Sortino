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

/**
 * Market hours: 9:30 AM - 4:00 PM ET.
 * MDT/MST: 7:30 AM - 2:00 PM (UTC-6).
 */
function isMarketOpen() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const mdt = new Date(utc + -6 * 3600000);
  const hour = mdt.getHours();
  const min = mdt.getMinutes();
  const day = mdt.getDay();

  if (day === 0 || day === 6) return false;
  if (hour < 7) return false;
  if (hour === 7 && min < 30) return false;
  if (hour >= 14) return false;
  return true;
}

async function getModelPrediction(ticker) {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:37',message:'Model API request start',data:{ticker,modelApiUrl:MODEL_API_URL},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    const res = await fetch(`${MODEL_API_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, period: '1mo' }),
    });
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:45',message:'Model API response',data:{ticker,status:res.status,ok:res.ok},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    if (!res.ok) throw new Error(`Model API ${res.status}`);
    const data = await res.json();
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:48',message:'Model API data parsed',data:{ticker,hasData:!!data,error:data?.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    return data;
  } catch (e) {
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:50',message:'Model API error',data:{ticker,error:e.message,modelApiUrl:MODEL_API_URL},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    console.error(`Model prediction ${ticker}:`, e.message);
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
  const res = await fetch(url, opts);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
  return data;
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
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:114',message:'Market hours check',data:{accountId,marketOpen,now:new Date().toISOString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
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

  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:165',message:'Starting ticker loop',data:{accountId,modelApiUrl:MODEL_API_URL,tickerCount:DOW_30.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion

  for (const ticker of DOW_30) {
    try {
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:168',message:'Fetching model prediction',data:{accountId,ticker},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      const pred = await getModelPrediction(ticker);
      
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:171',message:'Model prediction received',data:{accountId,ticker,hasPrediction:!!pred,error:pred?.error,action:pred?.action,actionCode:pred?.action_code,price:pred?.price},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      if (!pred || pred.error) {
        results.push({ ticker, status: 'skip', reason: 'no_prediction' });
        continue;
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
            results.push({ ticker, action: 'BUY', qty: closeQty, status: 'covered_short' });
          } else {
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:209',message:'Skipped: already long',data:{accountId,ticker},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
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
  
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/loop.js:276',message:'Trading loop completed all tickers',data:{accountId,resultsCount:results.length,results:results.map(r=>({ticker:r.ticker,status:r.status,reason:r.reason,action:r.action}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion

  try {
    await pool.query(
      `UPDATE bot_state 
       SET last_heartbeat = NOW(), last_error = NULL, updated_at = NOW()
       WHERE account_id = $1 
       AND account_id IN (SELECT id FROM accounts)`,
      [accountId]
    );
  } catch (e) {
    // If update fails due to foreign key constraint, log but don't throw
    // The trading loop completed successfully, this is just a state update
    console.warn(`[loop] Could not update final heartbeat for account ${accountId}:`, e.message);
  }

  return { success: true, results };
}

export { isMarketOpen };
