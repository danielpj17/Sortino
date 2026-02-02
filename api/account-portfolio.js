/**
 * Account Portfolio API - Fetch live portfolio data from Alpaca for a given account.
 * GET /api/account-portfolio?account_id=<id>
 * Returns: portfolio_value, buying_power, cash, positions
 */

import { getDecryptedAccount } from '../lib/account-credentials.js';
import { safeLogError } from '../lib/safeLog.js';

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
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
      throw new Error(`Alpaca API timeout: ${path}`);
    }
    throw e;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { account_id } = req.query;
  if (!account_id) {
    return res.status(400).json({ error: 'account_id required' });
  }

  try {
    const acc = await getDecryptedAccount(account_id);
    const baseUrl = String(acc.type).toLowerCase() === 'paper'
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';

    const headers = {
      'APCA-API-KEY-ID': acc.api_key,
      'APCA-API-SECRET-KEY': acc.secret_key,
    };

    const [accountData, positionsData] = await Promise.all([
      alpacaFetch(baseUrl, '/v2/account', {}, headers),
      alpacaFetch(baseUrl, '/v2/positions', {}, headers).catch((e) => {
        safeLogError('[account-portfolio] positions fetch:', e);
        return [];
      }),
    ]);

    const portfolio_value = parseFloat(accountData.portfolio_value) || 0;
    const buying_power = parseFloat(accountData.buying_power) || 0;
    const cash = parseFloat(accountData.cash) || 0;

    const positions = Array.isArray(positionsData)
      ? positionsData.map((p) => ({
          symbol: p.symbol,
          qty: parseInt(p.qty, 10),
          side: p.side,
          market_value: parseFloat(p.market_value) || 0,
          unrealized_pl: parseFloat(p.unrealized_pl) || 0,
        }))
      : [];

    res.status(200).json({
      portfolio_value,
      buying_power,
      cash,
      positions,
    });
  } catch (err) {
    safeLogError('[account-portfolio]', err);
    return res.status(500).json({
      error: err.message || 'Failed to fetch portfolio',
    });
  }
}
