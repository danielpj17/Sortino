import { getPool } from './db.js';

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
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set');
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { account_id } = req.query;
    const pool = getPool();
    
    let query = `
      SELECT 
        id,
        name,
        COALESCE(bot_name, 'ALPHA-01') as bot_name,
        COALESCE(account_type_display, 'MARGIN') as account_type_display,
        COALESCE(strategy_name, 'STANDARD STRATEGY') as strategy_name,
        api_key,
        secret_key,
        type
      FROM accounts
    `;
    const params = [];
    
    if (account_id) {
      query += ' WHERE id = $1';
      params.push(account_id);
    } else {
      query += ' ORDER BY id LIMIT 1';
    }
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(200).json({
        account_name: 'STANDARD STRATEGY',
        bot_name: 'ALPHA-01',
        account_type_display: 'MARGIN',
        strategy_name: 'STANDARD STRATEGY',
        api_status: 'DISCONNECTED'
      });
    }

    const account = result.rows[0];
    
    // Check API status by attempting to connect to Alpaca
    let apiStatus = 'CONNECTED';
    try {
      if (account.api_key && account.secret_key) {
        const baseUrl = account.type === 'Paper' 
          ? 'https://paper-api.alpaca.markets' 
          : 'https://api.alpaca.markets';
        
        // Test connection using fetch
        const response = await fetch(`${baseUrl}/v2/account`, {
          headers: {
            'APCA-API-KEY-ID': account.api_key,
            'APCA-API-SECRET-KEY': account.secret_key
          }
        });
        
        if (!response.ok) {
          apiStatus = 'DISCONNECTED';
        }
      } else {
        apiStatus = 'DISCONNECTED';
      }
    } catch (err) {
      apiStatus = 'DISCONNECTED';
    }

    res.status(200).json({
      account_name: account.name || 'STANDARD STRATEGY',
      bot_name: account.bot_name,
      account_type_display: account.account_type_display,
      strategy_name: account.strategy_name,
      api_status: apiStatus
    });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
