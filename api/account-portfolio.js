/**
 * Account Portfolio API - Fetch live portfolio data from Alpaca for a given account.
 * GET /api/account-portfolio?account_id=<id>
 * Query params: include_positions (default true), include_activities, include_portfolio_history, range (1D|1W|1M|1Y|YTD)
 * Returns: portfolio_value, buying_power, cash, positions, activities, completedTrades, portfolioHistory, todayGainDollars, todayGainPercent
 */

import { getDecryptedAccount } from '../lib/account-credentials.js';
import { safeLogError } from '../lib/safeLog.js';

const TZ = 'America/New_York';

function toEasternDateKey(d) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
}

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

function mapRangeToAlpaca(range) {
  const map = {
    '1D': { period: '1D', timeframe: '5Min' },
    '1W': { period: '1W', timeframe: '15Min' },
    '1M': { period: '1M', timeframe: '1H' },
    '1Y': { period: '1A', timeframe: '1D' },
    'YTD': { period: '1A', timeframe: '1D' },
  };
  return map[range] || map['1D'];
}

async function fetchAllFills(baseUrl, headers) {
  const fills = [];
  let pageToken = null;
  for (let i = 0; i < 20; i++) {
    const queryParams = { page_size: 100 };
    if (pageToken) queryParams.page_token = pageToken;
    const path = `/v2/account/activities/FILL`;
    const data = await alpacaFetch(baseUrl, path, { queryParams }, headers);
    const items = Array.isArray(data) ? data : (data.activities || data || []);
    fills.push(...items);
    pageToken = items.length >= 100 && items[items.length - 1]?.id ? items[items.length - 1].id : null;
    if (!pageToken || items.length < 100) break;
  }
  return fills.sort((a, b) => new Date(a.transaction_time || 0).getTime() - new Date(b.transaction_time || 0).getTime());
}

function matchFillsToCompletedTrades(fills) {
  const completed = [];
  const buyQueue = {};
  for (const f of fills) {
    const symbol = f.symbol || f.symbol_id;
    const side = (f.side || '').toLowerCase();
    const qty = parseInt(f.qty || f.cum_qty || 0, 10);
    const price = parseFloat(f.price || 0);
    const time = f.transaction_time || f.trade_time || f.created_at;
    if (!symbol || qty <= 0) continue;
    if (side === 'buy') {
      if (!buyQueue[symbol]) buyQueue[symbol] = [];
      buyQueue[symbol].push({ qty, price, time });
    } else if (side === 'sell') {
      if (!buyQueue[symbol] || buyQueue[symbol].length === 0) continue;
      let remaining = qty;
      let costBasis = 0;
      let matchedQty = 0;
      let buyTime = null;
      while (remaining > 0 && buyQueue[symbol].length > 0) {
        const lot = buyQueue[symbol][0];
        const take = Math.min(remaining, lot.qty);
        costBasis += take * lot.price;
        matchedQty += take;
        remaining -= take;
        lot.qty -= take;
        if (lot.qty <= 0) buyQueue[symbol].shift();
        if (!buyTime) buyTime = lot.time;
      }
      if (matchedQty > 0) {
        const avgBuyPrice = costBasis / matchedQty;
        completed.push({
          symbol,
          qty: matchedQty,
          buyPrice: avgBuyPrice,
          sellPrice: price,
          buyTime,
          sellTime: time,
          pnl: (price - avgBuyPrice) * matchedQty,
        });
      }
    }
  }
  return completed;
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

  const { account_id, include_positions, include_activities, include_portfolio_history, range } = req.query;
  if (!account_id) {
    return res.status(400).json({ error: 'account_id required' });
  }

  const wantPositions = include_positions !== 'false';
  const wantActivities = include_activities === 'true';
  const wantHistory = include_portfolio_history === 'true';
  const rangeVal = range || '1D';

  try {
    const acc = await getDecryptedAccount(account_id);
    const baseUrl = String(acc.type).toLowerCase() === 'paper'
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';

    const headers = {
      'APCA-API-KEY-ID': acc.api_key,
      'APCA-API-SECRET-KEY': acc.secret_key,
    };

    const fetches = [
      alpacaFetch(baseUrl, '/v2/account', {}, headers),
    ];
    if (wantPositions) {
      fetches.push(
        alpacaFetch(baseUrl, '/v2/positions', {}, headers).catch((e) => {
          safeLogError('[account-portfolio] positions fetch:', e);
          return [];
        })
      );
    } else {
      fetches.push(Promise.resolve([]));
    }

    if (wantActivities) {
      fetches.push(fetchAllFills(baseUrl, headers).catch((e) => {
        safeLogError('[account-portfolio] activities fetch:', e);
        return [];
      }));
    } else {
      fetches.push(Promise.resolve([]));
    }

    if (wantHistory) {
      const { period, timeframe } = mapRangeToAlpaca(rangeVal);
      fetches.push(
        alpacaFetch(baseUrl, '/v2/account/portfolio/history', { queryParams: { period, timeframe } }, headers).catch((e) => {
          safeLogError('[account-portfolio] portfolio history fetch:', e);
          return { timestamp: [], equity: [], profit_loss: [], profit_loss_pct: [] };
        })
      );
    } else {
      fetches.push(Promise.resolve(null));
    }

    const results = await Promise.all(fetches);
    const accountData = results[0];
    const positionsData = results[1];
    const allFills = results[2];
    const historyData = results[3];

    const portfolio_value = parseFloat(accountData.portfolio_value) || 0;
    let buying_power = parseFloat(accountData.buying_power) || 0;
    const cash = parseFloat(accountData.cash) || 0;
    if (acc.account_type_display === 'CASH') {
      buying_power = cash;
    }

    const positions = Array.isArray(positionsData)
      ? positionsData.map((p) => ({
          symbol: p.symbol,
          qty: parseInt(p.qty, 10),
          side: p.side,
          market_value: parseFloat(p.market_value) || 0,
          unrealized_pl: parseFloat(p.unrealized_pl) || 0,
          avg_entry_price: parseFloat(p.avg_entry_price) || 0,
          current_price: parseFloat(p.current_price) || parseFloat(p.market_value) / Math.max(1, parseInt(p.qty, 10)),
        }))
      : [];

    const completedTrades = matchFillsToCompletedTrades(allFills);

    let portfolioHistory = [];
    if (historyData && Array.isArray(historyData.equity) && Array.isArray(historyData.timestamp)) {
      portfolioHistory = historyData.timestamp.map((ts, i) => {
        const ms = ts > 1e12 ? ts : ts * 1000;
        return {
          time: new Date(ms).toISOString(),
          value: parseFloat(historyData.equity[i]) || 0,
        };
      });
    }
    // Filter out leading zero/negative values so we start from first meaningful balance (opening deposit)
    if (portfolioHistory.length > 0) {
      const sortedHist = [...portfolioHistory].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      const firstMeaningfulIdx = sortedHist.findIndex((p) => p.value > 0);
      if (firstMeaningfulIdx > 0) {
        portfolioHistory = sortedHist.slice(firstMeaningfulIdx);
      } else if (firstMeaningfulIdx === -1 && portfolio_value > 0) {
        portfolioHistory = [{ time: new Date().toISOString(), value: portfolio_value }];
      }
    }

    const sortedHistory = [...portfolioHistory].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const { gainDollars: todayGainDollars, gainPercent: todayGainPercent } = computeTodayGain(sortedHistory, portfolio_value);

    const response = {
      portfolio_value,
      buying_power,
      cash,
      positions,
      todayGainDollars,
      todayGainPercent,
    };
    if (wantActivities) {
      response.activities = allFills;
      response.completedTrades = completedTrades;
    }
    if (wantHistory) {
      response.portfolioHistory = portfolioHistory;
    }

    res.status(200).json(response);
  } catch (err) {
    safeLogError('[account-portfolio]', err);
    return res.status(500).json({
      error: err.message || 'Failed to fetch portfolio',
    });
  }
}
