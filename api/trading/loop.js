/**
 * Trading loop: one "tick" of the Heartbeat architecture.
 * Fetches predictions from Model API, executes via Alpaca, stores trades in Neon.
 */

import { getPool } from '../db.js';

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
    const res = await fetch(`${MODEL_API_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, period: '1mo' }),
    });
    if (!res.ok) throw new Error(`Model API ${res.status}`);
    return await res.json();
  } catch (e) {
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
  if (!isMarketOpen()) {
    const pool = getPool();
    await pool.query(
      `UPDATE bot_state SET last_heartbeat = NOW(), updated_at = NOW() WHERE account_id = $1`,
      [accountId]
    );
    return { success: true, results: [], skipped: true, reason: 'market_closed' };
  }

  const pool = getPool();

  const accountResult = await pool.query(
    `SELECT id, name, api_key, secret_key, type,
            COALESCE(allow_shorting, FALSE) AS allow_shorting,
            COALESCE(CAST(max_position_size AS FLOAT), 0.4) AS max_position_size
     FROM accounts WHERE id = $1`,
    [accountId]
  );

  if (accountResult.rows.length === 0) {
    throw new Error(`Account ${accountId} not found`);
  }

  const acc = accountResult.rows[0];
  const baseUrl = String(acc.type).toLowerCase() === 'paper'
    ? 'https://paper-api.alpaca.markets'
    : 'https://api.alpaca.markets';

  let account;
  try {
    account = await getAccount(acc.api_key, acc.secret_key, baseUrl);
  } catch (e) {
    await pool.query(
      `UPDATE bot_state SET last_error = $1, updated_at = NOW() WHERE account_id = $2`,
      [e.message, accountId]
    );
    throw e;
  }

  const buyingPower = parseFloat(account.buying_power) || 0;
  const portfolioValue = parseFloat(account.portfolio_value) || 0;
  const maxTradeValue = portfolioValue * (acc.max_position_size || 0.4);
  const tradeValue = Math.min(maxTradeValue, buyingPower);
  const allowShorting = !!acc.allow_shorting;

  const results = [];

  for (const ticker of DOW_30) {
    try {
      const pred = await getModelPrediction(ticker);
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
      if (qty <= 0) {
        results.push({ ticker, status: 'skip', reason: 'no_size' });
        continue;
      }

      const pos = await getPosition(acc.api_key, acc.secret_key, baseUrl, ticker);
      const side = pos ? String(pos.side).toLowerCase() : null;

      if (actionType === 'BUY') {
        if (pos) {
          if (side === 'short') {
            const closeQty = Math.abs(parseInt(pos.qty, 10));
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
            results.push({ ticker, action: 'BUY', qty: closeQty, status: 'covered_short' });
          } else {
            results.push({ ticker, action: 'BUY', status: 'skip', reason: 'already_long' });
          }
        } else {
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
          results.push({ ticker, action: 'BUY', qty, status: 'filled' });
        }
      } else {
        if (pos) {
          if (side === 'long') {
            const closeQty = parseInt(pos.qty, 10);
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
            results.push({ ticker, action: 'SELL', qty: closeQty, status: 'closed_long' });
          } else {
            results.push({ ticker, action: 'SELL', status: 'skip', reason: 'already_short' });
          }
        } else {
          if (allowShorting) {
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
            results.push({ ticker, action: 'SELL', qty, status: 'short_opened' });
          } else {
            results.push({ ticker, action: 'SELL', status: 'skip', reason: 'shorting_disabled' });
          }
        }
      }
    } catch (e) {
      console.error(`Trading loop ${ticker}:`, e);
      results.push({ ticker, status: 'error', error: e.message });
    }
  }

  await pool.query(
    `UPDATE bot_state SET last_heartbeat = NOW(), last_error = NULL, updated_at = NOW()
     WHERE account_id = $1`,
    [accountId]
  );

  return { success: true, results };
}

export { isMarketOpen };
