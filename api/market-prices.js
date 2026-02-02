import { getPool } from '../lib/db.js';
import { getDecryptedAccount } from '../lib/account-credentials.js';
import { safeLogError } from '../lib/safeLog.js';

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

    // Get decrypted account credentials for Alpaca API
    let account;
    if (account_id) {
      try {
        account = await getDecryptedAccount(account_id);
      } catch (err) {
        safeLogError('[market-prices] getDecryptedAccount:', err);
        return res.status(200).json(cached);
      }
    } else {
      // Legacy: no account_id - use first Paper account
      const pool = getPool();
      const idResult = await pool.query(
        "SELECT id FROM accounts WHERE type = 'Paper' LIMIT 1"
      );
      if (idResult.rows.length === 0) {
        return res.status(200).json(cached);
      }
      try {
        account = await getDecryptedAccount(idResult.rows[0].id);
      } catch (err) {
        safeLogError('[market-prices] getDecryptedAccount:', err);
        return res.status(200).json(cached);
      }
    }

    const baseUrl = String(account.type).toLowerCase() === 'paper'
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';

    // Fetch prices from Alpaca
    const prices = {};
    
    try {
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
