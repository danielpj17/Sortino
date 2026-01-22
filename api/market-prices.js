import { getPool } from './db.js';
import { safeLogError } from './safeLog.js';

// Simple in-memory cache (30 seconds TTL)
const priceCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
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

  try {
    const { tickers, account_id } = req.query;
    
    if (!tickers) {
      return res.status(400).json({ error: 'tickers parameter required' });
    }

    const tickerList = tickers.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    if (tickerList.length === 0) {
      return res.status(400).json({ error: 'No valid tickers provided' });
    }

    // Check cache first
    const now = Date.now();
    const cached = {};
    const toFetch = [];
    
    for (const ticker of tickerList) {
      const cachedEntry = priceCache.get(ticker);
      if (cachedEntry && (now - cachedEntry.timestamp) < CACHE_TTL) {
        cached[ticker] = cachedEntry.price;
      } else {
        toFetch.push(ticker);
      }
    }

    // If all cached, return immediately
    if (toFetch.length === 0) {
      return res.status(200).json(cached);
    }

    // Get account credentials for Alpaca API
    const pool = getPool();
    let accountQuery = 'SELECT api_key, secret_key, type FROM accounts';
    const queryParams = [];
    
    if (account_id) {
      accountQuery += ' WHERE id = $1';
      queryParams.push(account_id);
    }
    
    accountQuery += ' LIMIT 1';
    const accountResult = await pool.query(accountQuery, queryParams);
    
    if (accountResult.rows.length === 0) {
      // If no account, return cached prices or empty
      return res.status(200).json(cached);
    }

    const account = accountResult.rows[0];
    const baseUrl = account.type === 'Paper' 
      ? 'https://paper-api.alpaca.markets' 
      : 'https://api.alpaca.markets';

    // Fetch prices from Alpaca
    const prices = {};
    
    try {
      // Use Alpaca REST API to get latest trades
      const headers = {
        'APCA-API-KEY-ID': account.api_key,
        'APCA-API-SECRET-KEY': account.secret_key
      };
      
      // Fetch latest trades for each ticker
      for (const ticker of toFetch) {
        try {
          const response = await fetch(`${baseUrl}/v2/stocks/${ticker}/trades/latest`, {
            headers
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.trade && data.trade.p) {
              const price = parseFloat(data.trade.p);
              prices[ticker] = price;
              // Update cache
              priceCache.set(ticker, { price, timestamp: now });
            }
          }
        } catch (err) {
          safeLogError(`Error fetching price for ${ticker}:`, err);
          // Use cached price if available, otherwise skip
          const oldCache = priceCache.get(ticker);
          if (oldCache) {
            prices[ticker] = oldCache.price;
          }
        }
      }
    } catch (err) {
      safeLogError('Error fetching market prices:', err);
      // Return cached prices if available
      return res.status(200).json(cached);
    }

    // Merge cached and fetched prices
    const result = { ...cached, ...prices };
    res.status(200).json(result);
  } catch (err) {
    safeLogError('Database error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
