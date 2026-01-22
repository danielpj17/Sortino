import { getPool } from './db.js';
import { safeLogError } from './safeLog.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Handle POST requests (update settings)
  if (req.method === 'POST') {
    try {
      if (!process.env.DATABASE_URL) {
        return res.status(500).json({ error: 'Database not configured' });
      }

      // Parse request body (Vercel should auto-parse JSON, but ensure it's an object)
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch (e) {
          return res.status(400).json({ error: 'Invalid JSON in request body' });
        }
      }

      const { account_id, strategy_name, account_type_display, allow_shorting } = body;

      if (!account_id) {
        return res.status(400).json({ error: 'account_id is required' });
      }

      // Parse account_id as integer
      const accountIdInt = parseInt(account_id, 10);
      if (isNaN(accountIdInt)) {
        return res.status(400).json({ error: 'account_id must be a valid number' });
      }

      const pool = getPool();
      
      // First, ensure columns exist by attempting to update them
      // If columns don't exist, this will fail gracefully
      let updateQuery = `
        UPDATE accounts 
        SET strategy_name = $1,
            account_type_display = $2,
            allow_shorting = $3
        WHERE id = $4
      `;
      
      try {
        await pool.query(updateQuery, [
          strategy_name || "Sortino's Model",
          account_type_display || 'CASH',
          allow_shorting || false,
          accountIdInt
        ]);
      } catch (updateErr) {
        // If columns don't exist, return error suggesting migration
        if (updateErr.message && updateErr.message.includes('column') && updateErr.message.includes('does not exist')) {
          return res.status(500).json({ 
            error: 'Database schema not up to date. Please run the migration SQL from schema.sql',
            details: 'Missing columns: strategy_name, account_type_display, or allow_shorting'
          });
        }
        throw updateErr;
      }
      
      // Fetch updated account
      const fetchQuery = `
        SELECT 
          id,
          name,
          COALESCE(bot_name, 'ALPHA-01') as bot_name,
          COALESCE(account_type_display, 'CASH') as account_type_display,
          COALESCE(strategy_name, 'Sortino''s Model') as strategy_name,
          COALESCE(allow_shorting, FALSE) as allow_shorting
        FROM accounts
        WHERE id = $1
      `;
      
      const result = await pool.query(fetchQuery, [accountIdInt]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }

      const account = result.rows[0];
      
      // If extended columns don't exist, use defaults
      if (account.bot_name === undefined) {
        account.bot_name = 'ALPHA-01';
        account.account_type_display = account_type_display || 'CASH';
        account.strategy_name = strategy_name || "Sortino's Model";
        account.allow_shorting = allow_shorting || false;
      }

      res.status(200).json({
        account_name: account.name || 'STANDARD STRATEGY',
        bot_name: account.bot_name,
        account_type_display: account.account_type_display,
        strategy_name: account.strategy_name,
        allow_shorting: account.allow_shorting,
        api_status: 'CONNECTED' // Could check API status here if needed
      });
    } catch (err) {
      safeLogError('Database error (POST):', err);
      res.status(500).json({ error: 'Internal server error', details: err?.message });
    }
    return;
  }

  // Handle GET requests (fetch settings)
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
    
    // Try full query with extended columns first
    let query = `
      SELECT 
        id,
        name,
        COALESCE(bot_name, 'ALPHA-01') as bot_name,
        COALESCE(account_type_display, 'CASH') as account_type_display,
        COALESCE(strategy_name, 'Sortino''s Model') as strategy_name,
        COALESCE(allow_shorting, FALSE) as allow_shorting,
        api_key,
        secret_key,
        type
      FROM accounts
    `;
    const params = [];
    
    if (account_id) {
      // Parse account_id as integer
      const accountIdInt = parseInt(account_id, 10);
      if (isNaN(accountIdInt)) {
        return res.status(400).json({ error: 'account_id must be a valid number' });
      }
      query += ' WHERE id = $1';
      params.push(accountIdInt);
    } else {
      query += ' ORDER BY id LIMIT 1';
    }
    
    let result;
    try {
      result = await pool.query(query, params);
    } catch (queryErr) {
      // If columns don't exist, fall back to basic query
      if (queryErr.message && queryErr.message.includes('column') && queryErr.message.includes('does not exist')) {
        console.warn('Extended columns not available, using basic query');
        const basicQuery = `
          SELECT 
            id,
            name,
            api_key,
            secret_key,
            type
          FROM accounts
          ${account_id ? 'WHERE id = $1' : 'ORDER BY id LIMIT 1'}
        `;
        result = await pool.query(basicQuery, params);
      } else {
        throw queryErr;
      }
    }
    
    if (result.rows.length === 0) {
      return res.status(200).json({
        account_name: 'STANDARD STRATEGY',
        bot_name: 'ALPHA-01',
        account_type_display: 'CASH',
        strategy_name: "Sortino's Model",
        allow_shorting: false,
        api_status: 'DISCONNECTED'
      });
    }

    const account = result.rows[0];
    
    // Use extended columns if available, otherwise use defaults
    const bot_name = account.bot_name !== undefined ? account.bot_name : 'ALPHA-01';
    const account_type_display = account.account_type_display !== undefined ? account.account_type_display : 'CASH';
    const strategy_name = account.strategy_name !== undefined ? account.strategy_name : "Sortino's Model";
    const allow_shorting = account.allow_shorting !== undefined ? account.allow_shorting : false;
    
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
      bot_name: bot_name,
      account_type_display: account_type_display,
      strategy_name: strategy_name,
      allow_shorting: allow_shorting,
      api_status: apiStatus
    });
  } catch (err) {
    safeLogError('Database error (GET):', err);
    res.status(500).json({ error: 'Internal server error', details: err?.message });
  }
}
