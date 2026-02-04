/**
 * Dashboard Summary API - Combined portfolio data for all accounts of a type (Paper | Live).
 * GET /api/dashboard-summary?type=Paper|Live&range=1D|1W|1M|1Y|YTD
 * Returns: combinedHistory, combinedEquity, combinedGainDollars, combinedGainPercent (today's), accounts[]
 */

import { getPool } from '../lib/db.js';

const TZ = 'America/New_York';

/** Return YYYY-MM-DD for a date in Eastern (for "today" comparison). */
function toEasternDateKey(d) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
}

/**
 * Compute today's $ and % gain from history and current equity.
 * Today's open = first equity value with same calendar day (Eastern) as now; if none, use last point before today.
 */
function computeTodayGain(sorted, currentEquity) {
  if (!sorted || sorted.length === 0) {
    return { gainDollars: 0, gainPercent: 0 };
  }
  const todayKey = toEasternDateKey(new Date());
  const todayPoints = sorted.filter((p) => toEasternDateKey(p.time) === todayKey);
  let openVal;
  if (todayPoints.length > 0) {
    openVal = todayPoints[0].value;
  } else {
    const beforeToday = sorted.filter((p) => toEasternDateKey(p.time) < todayKey);
    openVal = beforeToday.length > 0 ? beforeToday[beforeToday.length - 1].value : sorted[0].value;
  }
  const gainDollars = currentEquity - openVal;
  const gainPercent = openVal > 0 ? (gainDollars / openVal) * 100 : 0;
  return { gainDollars, gainPercent };
}
import { getDecryptedAccount } from '../lib/account-credentials.js';
import { safeLogError } from '../lib/safeLog.js';

function mapRangeToAlpaca(range) {
  const map = {
    '1D': { period: '1D', timeframe: '5Min' },
    '1W': { period: '1W', timeframe: '15Min' },
    // Same as account-portfolio: 1A/1D for 1M so Alpaca returns data; trim to 30 days below
    '1M': { period: '1A', timeframe: '1D' },
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

    // For 1M we requested 1A/1D; keep only the last 30 days (same as account-portfolio)
    if (rangeVal === '1M' && history.length > 0) {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      history = history
        .filter((p) => new Date(p.time).getTime() >= cutoff)
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    }

    const sorted = [...history].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const { gainDollars, gainPercent } = computeTodayGain(sorted, equity);

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

  // Pre-sort each account's history and find its first meaningful value (opening balance)
  // Use current equity when account has no history, no positive point, or first value is 0 (e.g. Alpaca zero bars) so it still contributes to combined backfill
  const preparedAccounts = accountSummaries.map((acc) => {
    const sorted = [...acc.history].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const firstMeaningful = sorted.find((p) => p.value > 0) ?? sorted[0];
    const firstValue =
      firstMeaningful?.value != null && firstMeaningful.value > 0
        ? firstMeaningful.value
        : acc.equity > 0
          ? acc.equity
          : 0;
    return { sorted, firstValue };
  });

  const combinedOpeningBalance = preparedAccounts.reduce((sum, p) => sum + p.firstValue, 0);

  if (sortedTimes.length === 0) {
    return { history: [], combinedOpeningBalance };
  }

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
  const history = result.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  return { history, combinedOpeningBalance };
}

/**
 * Build equity history from DB trades for one account (same logic as stats API).
 * Used when Alpaca returns empty history for 1W/1M so combined chart matches individual chart.
 */
async function getEquityHistoryFromDb(pool, accountId, accountType, rangeVal) {
  if (rangeVal !== '1W' && rangeVal !== '1M') return [];
  const now = new Date();
  let startTime;
  if (rangeVal === '1W') {
    startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  const startingCapital = accountType === 'Paper' ? 100000 : 10000;
  const timeInterval = rangeVal === '1W' ? 'hour' : 'day';

  const equityQuery = `
    SELECT t.timestamp, t.pnl, DATE_TRUNC('${timeInterval}', t.timestamp) as time_bucket
    FROM trades t
    JOIN accounts a ON t.account_id = a.id
    WHERE t.timestamp >= $1 AND a.type = $2 AND t.account_id = $3
    ORDER BY t.timestamp
  `;
  const equityResult = await pool.query(equityQuery, [
    startTime.toISOString(),
    accountType,
    accountId,
  ]);

  const tradePoints = [];
  let cumulativePnL = 0;

  if (rangeVal === '1W') {
    const bucketMap = new Map();
    for (const row of equityResult.rows) {
      cumulativePnL += parseFloat(row.pnl || 0);
      const ts = new Date(row.timestamp).getTime();
      const bucketMs = Math.floor(ts / (15 * 60 * 1000)) * 15 * 60 * 1000;
      bucketMap.set(bucketMs, {
        time: new Date(bucketMs).toISOString(),
        cumulativePnL,
      });
    }
    tradePoints.push(...Array.from(bucketMap.values()));
    tradePoints.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  } else {
    const bucketMap = new Map();
    for (const row of equityResult.rows) {
      cumulativePnL += parseFloat(row.pnl || 0);
      const bucketKey = new Date(row.time_bucket).toISOString();
      bucketMap.set(bucketKey, { time: bucketKey, cumulativePnL });
    }
    tradePoints.push(...Array.from(bucketMap.values()));
    tradePoints.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }

  const formattedData = [
    { time: startTime.toISOString(), value: startingCapital },
    ...tradePoints.map((p) => ({
      time: p.time,
      value: Math.round(startingCapital + p.cumulativePnL),
    })),
  ];

  const endValue =
    currentEquity != null && currentEquity > 0
      ? currentEquity
      : formattedData.length > 0
        ? formattedData[formattedData.length - 1].value
        : startingCapital;
  formattedData.push({ time: now.toISOString(), value: endValue });

  const seen = new Set();
  const unique = formattedData.filter((p) => {
    const key = new Date(p.time).toISOString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  return unique;
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
        combinedOpeningBalance: 0,
        accounts: [],
      });
    }

    const accountSummaries = await Promise.all(
      rows.map((row) =>
        fetchAccountSummary(row.id, row.name, row.type, rangeVal)
      )
    );

    // For 1W/1M, when Alpaca returned empty history for an account, use DB (stats) so combined = sum of individual charts
    if (rangeVal === '1W' || rangeVal === '1M') {
      for (const summary of accountSummaries) {
        if (summary.history.length === 0 && summary.equity > 0) {
          try {
            summary.history = await getEquityHistoryFromDb(
              pool,
              summary.id,
              type,
              rangeVal,
              summary.equity
            );
          } catch (e) {
            safeLogError('[dashboard-summary] equity fallback for ' + summary.id + ':', e);
          }
        }
      }
    }

    const { history: combinedHistory, combinedOpeningBalance } = mergeHistories(accountSummaries);
    const combinedEquity = accountSummaries.reduce((s, a) => s + a.equity, 0);
    const { gainDollars: combinedGainDollars, gainPercent: combinedGainPercent } = computeTodayGain(
      combinedHistory,
      combinedEquity
    );

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
      combinedOpeningBalance,
      accounts,
    });
  } catch (err) {
    safeLogError('[dashboard-summary]', err);
    return res.status(500).json({
      error: err.message || 'Failed to fetch dashboard summary',
    });
  }
}
