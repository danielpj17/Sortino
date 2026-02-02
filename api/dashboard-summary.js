/**
 * Dashboard Summary API - Combined portfolio data for all accounts of a type (Paper | Live).
 * GET /api/dashboard-summary?type=Paper|Live&range=1D|1W|1M|1Y|YTD
 * Returns: combinedHistory, combinedEquity, combinedGainDollars, combinedGainPercent, accounts[]
 */

import { getPool } from '../lib/db.js';
import { getDecryptedAccount } from '../lib/account-credentials.js';
import { safeLogError } from '../lib/safeLog.js';

function mapRangeToAlpaca(range) {
  const map = {
    '1D': { period: '1D', timeframe: '15Min' },
    '1W': { period: '1W', timeframe: '1H' },
    '1M': { period: '1M', timeframe: '1D' },
    '1Y': { period: '1A', timeframe: '1D' },
    'YTD': { period: '1A', timeframe: '1D' },
  };
  return map[range] || map['1D'];
}

async function alpacaFetch(baseUrl, path, { method = 'GET', body, queryParams } = {}, headers = {}) {
  let url = `${baseUrl}${path}`;
  if (queryParams && Object.keys(queryParams).length > 0) {
    const search = new URLSearchParams(queryParams).toString();
    url += (path.includes('?') ? '&' : '?') + search;
  }
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

/**
 * Fetch account value and portfolio history for one account. Returns { equity, history }.
 * On error returns { equity: 0, history: [] } so we can still return partial combined data.
 */
async function fetchAccountSummary(accountId, accountName, accountType, rangeVal) {
  try {
    const acc = await getDecryptedAccount(accountId);
    const baseUrl = String(accountType).toLowerCase() === 'paper'
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';
    const headers = {
      'APCA-API-KEY-ID': acc.api_key,
      'APCA-API-SECRET-KEY': acc.secret_key,
    };

    const { period, timeframe } = mapRangeToAlpaca(rangeVal);
    const [accountData, historyData] = await Promise.all([
      alpacaFetch(baseUrl, '/v2/account', {}, headers),
      alpacaFetch(baseUrl, '/v2/account/portfolio/history', { queryParams: { period, timeframe } }, headers).catch((e) => {
        safeLogError('[dashboard-summary] portfolio history:', e);
        return { timestamp: [], equity: [], profit_loss: [], profit_loss_pct: [] };
      }),
    ]);

    const equity = parseFloat(accountData.portfolio_value) || 0;
    let history = [];
    if (historyData && Array.isArray(historyData.equity) && Array.isArray(historyData.timestamp)) {
      history = historyData.timestamp.map((ts, i) => {
        const ms = ts > 1e12 ? ts : ts * 1000;
        return {
          time: new Date(ms).toISOString(),
          value: parseFloat(historyData.equity[i]) || 0,
        };
      });
    }
    // Filter out leading zero/negative values so we start from first meaningful balance (opening deposit)
    if (history.length > 0) {
      const sortedHist = [...history].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      const firstMeaningfulIdx = sortedHist.findIndex((p) => p.value > 0);
      if (firstMeaningfulIdx > 0) {
        history = sortedHist.slice(firstMeaningfulIdx);
      } else if (firstMeaningfulIdx === -1 && equity > 0) {
        // All zeros but we have current equity - use that
        history = [{ time: new Date().toISOString(), value: equity }];
      }
    }
    if (history.length === 0 && equity > 0) {
      history = [{ time: new Date().toISOString(), value: equity }];
    }

    const sorted = [...history].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    let gainDollars = 0;
    let gainPercent = 0;
    if (sorted.length >= 2) {
      const firstVal = sorted[0].value;
      const lastVal = sorted[sorted.length - 1].value;
      gainDollars = lastVal - firstVal;
      gainPercent = firstVal > 0 ? (gainDollars / firstVal) * 100 : 0;
    } else if (sorted.length === 1) {
      gainDollars = equity - sorted[0].value;
      gainPercent = sorted[0].value > 0 ? (gainDollars / sorted[0].value) * 100 : 0;
    }

    return {
      id: accountId,
      name: accountName,
      equity,
      history,
      gainDollars,
      gainPercent,
    };
  } catch (err) {
    safeLogError('[dashboard-summary] account ' + accountId + ':', err);
    return {
      id: accountId,
      name: accountName,
      equity: 0,
      history: [],
      gainDollars: 0,
      gainPercent: 0,
    };
  }
}

/**
 * Merge multiple account histories into one time series (sum of equity at each timestamp).
 * Union of timestamps; for each account without a point at a timestamp, use first meaningful value
 * (opening balance) to backfill, so the combined line stays flat at the combined opening balance
 * until real data starts.
 */
function mergeHistories(accountSummaries) {
  const timeSet = new Set();
  for (const acc of accountSummaries) {
    for (const p of acc.history) {
      timeSet.add(new Date(p.time).getTime());
    }
  }
  const sortedTimes = Array.from(timeSet).sort((a, b) => a - b);
  if (sortedTimes.length === 0) return [];

  // Pre-sort each account's history and find its first meaningful value (opening balance)
  const preparedAccounts = accountSummaries.map((acc) => {
    const sorted = [...acc.history].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const firstMeaningful = sorted.find((p) => p.value > 0) ?? sorted[0];
    const firstValue = firstMeaningful?.value ?? 0;
    return { sorted, firstValue };
  });

  const result = [];
  for (const ms of sortedTimes) {
    let total = 0;
    for (const { sorted, firstValue } of preparedAccounts) {
      // Find last known value at or before this timestamp
      let value = firstValue; // Default to opening balance (backfill) instead of 0
      for (const p of sorted) {
        if (new Date(p.time).getTime() <= ms) value = p.value;
      }
      total += value;
    }
    result.push({ time: new Date(ms).toISOString(), value: total });
  }
  return result.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
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

  const { type, range: rangeParam } = req.query;
  const rangeVal = rangeParam || '1D';
  if (!type || !['Paper', 'Live'].includes(type)) {
    return res.status(400).json({ error: 'type must be Paper or Live' });
  }

  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, name, type FROM accounts WHERE type = $1 ORDER BY name`,
      [type]
    );
    const rows = result.rows || [];

    if (rows.length === 0) {
      return res.status(200).json({
        combinedHistory: [],
        combinedEquity: 0,
        combinedGainDollars: 0,
        combinedGainPercent: 0,
        accounts: [],
      });
    }

    const accountSummaries = await Promise.all(
      rows.map((row) =>
        fetchAccountSummary(row.id, row.name, row.type, rangeVal)
      )
    );

    const combinedHistory = mergeHistories(accountSummaries);
    const combinedEquity = accountSummaries.reduce((s, a) => s + a.equity, 0);

    let combinedGainDollars = 0;
    let combinedGainPercent = 0;
    if (combinedHistory.length >= 2) {
      const firstVal = combinedHistory[0].value;
      const lastVal = combinedHistory[combinedHistory.length - 1].value;
      combinedGainDollars = lastVal - firstVal;
      combinedGainPercent = firstVal > 0 ? (combinedGainDollars / firstVal) * 100 : 0;
    }

    const accounts = accountSummaries.map((a) => ({
      id: a.id,
      name: a.name,
      equity: a.equity,
      gainDollars: a.gainDollars,
      gainPercent: a.gainPercent,
    }));

    res.status(200).json({
      combinedHistory,
      combinedEquity,
      combinedGainDollars,
      combinedGainPercent,
      accounts,
    });
  } catch (err) {
    safeLogError('[dashboard-summary]', err);
    return res.status(500).json({
      error: err.message || 'Failed to fetch dashboard summary',
    });
  }
}
