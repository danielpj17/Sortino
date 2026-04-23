import { getPool } from '../lib/db.js';
import { safeLogError } from '../lib/safeLog.js';
import { decrypt } from '../lib/encryption.js';

/** Same mapping as api/trading/loop.js */
const STRATEGY_NAME_TO_KEY = {
  'Sortino Model': 'sortino',
  'Upside Model': 'upside',
};

/** Match python_engine/model_manager.display_name_for_retrain_date (UTC calendar date). */
function formatActiveModelDisplay(strategy, createdAt) {
  if (createdAt == null) return null;
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  const label = `${mm}-${dd}-${yy}`;
  if (strategy === 'upside') return `Upside_(${label})`;
  return `Sortino_(${label})`;
}

async function fetchActiveModelVersions(pool) {
  try {
    const { rows } = await pool.query(`
      SELECT strategy, version_number, model_path, created_at
      FROM model_versions
      WHERE is_active = TRUE AND strategy IN ('sortino', 'upside')
    `);
    const models_active = {};
    for (const row of rows) {
      const s = row.strategy;
      if (s !== 'sortino' && s !== 'upside') continue;
      const created = row.created_at || null;
      models_active[s] = {
        version_number: row.version_number,
        model_path: row.model_path,
        display_name: formatActiveModelDisplay(s, created),
        created_at: created ? created.toISOString() : null,
      };
    }
    return models_active;
  } catch (e) {
    safeLogError('fetchActiveModelVersions:', e);
    return {};
  }
}

function activeModelDisplayForAccount(strategyName, models_active) {
  const key = STRATEGY_NAME_TO_KEY[strategyName] || 'sortino';
  const row = models_active[key];
  return row ? row.display_name : null;
}

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

      const { account_id, strategy_name, account_type_display, allow_shorting, cash_mode,
              capital_utilization, allow_overnight } = body;

      if (!account_id) {
        return res.status(400).json({ error: 'account_id is required' });
      }

      const pool = getPool();
      
      // First, ensure columns exist by attempting to update them
      // If columns don't exist, this will fail gracefully
      const capitalUtil = Math.min(2.0, Math.max(0.0, parseFloat(capital_utilization) || 1.0));
      const allowOvernight = allow_overnight !== false;

      let updateQuery = `
        UPDATE accounts
        SET strategy_name = $1,
            account_type_display = $2,
            allow_shorting = $3,
            cash_mode = $5,
            capital_utilization = $6,
            allow_overnight = $7
        WHERE id = $4
      `;

      try {
        await pool.query(updateQuery, [
          strategy_name || "Sortino Model",
          account_type_display || 'CASH',
          allow_shorting || false,
          account_id,
          cash_mode || 'SETTLED',
          capitalUtil,
          allowOvernight
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
          COALESCE(strategy_name, 'Sortino Model') as strategy_name,
          COALESCE(allow_shorting, FALSE) as allow_shorting,
          COALESCE(cash_mode, 'SETTLED') as cash_mode,
          COALESCE(CAST(capital_utilization AS FLOAT), 1.0) as capital_utilization,
          COALESCE(allow_overnight, TRUE) as allow_overnight,
          api_key,
          secret_key,
          type
        FROM accounts
        WHERE id = $1
      `;
      
      const result = await pool.query(fetchQuery, [account_id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }

      const account = result.rows[0];
      
      // If extended columns don't exist, use defaults
      if (account.bot_name === undefined) {
        account.bot_name = 'ALPHA-01';
        account.account_type_display = account_type_display || 'CASH';
        account.strategy_name = strategy_name || "Sortino Model";
        account.allow_shorting = allow_shorting || false;
        account.cash_mode = cash_mode || 'SETTLED';
      }

      // Check API status for POST as well
      let apiStatus = 'CONNECTED';
      let apiError = null;
      try {
        if (account.api_key && account.secret_key) {
          // Decrypt the API keys before using them
          const decryptedApiKey = decrypt(account.api_key);
          const decryptedSecretKey = decrypt(account.secret_key);
          
          const baseUrl = account.type === 'Paper' 
            ? 'https://paper-api.alpaca.markets' 
            : 'https://api.alpaca.markets';
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          try {
            const response = await fetch(`${baseUrl}/v2/account`, {
              headers: {
                'APCA-API-KEY-ID': decryptedApiKey,
                'APCA-API-SECRET-KEY': decryptedSecretKey
              },
              signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
              apiStatus = 'DISCONNECTED';
              if (response.status === 401) {
                apiError = 'Invalid API credentials';
              } else if (response.status === 403) {
                apiError = 'API access forbidden';
              } else {
                apiError = `API error: ${response.status}`;
              }
            }
          } catch (fetchErr) {
            clearTimeout(timeoutId);
            if (fetchErr.name === 'AbortError') {
              apiStatus = 'DISCONNECTED';
              apiError = 'Connection timeout';
            } else {
              throw fetchErr;
            }
          }
        } else {
          apiStatus = 'DISCONNECTED';
          apiError = 'API credentials missing';
        }
      } catch (err) {
        apiStatus = 'DISCONNECTED';
        apiError = err.message || 'Connection failed';
      }

      const models_active = await fetchActiveModelVersions(pool);
      const active_model_display = activeModelDisplayForAccount(account.strategy_name, models_active);

      res.status(200).json({
        account_name: account.name || 'STANDARD STRATEGY',
        bot_name: account.bot_name,
        account_type_display: account.account_type_display,
        strategy_name: account.strategy_name,
        allow_shorting: account.allow_shorting,
        cash_mode: account.cash_mode,
        capital_utilization: account.capital_utilization ?? 1.0,
        allow_overnight: account.allow_overnight ?? true,
        api_status: apiStatus,
        api_error: apiError || null,
        active_model_display,
        models_active,
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
        COALESCE(strategy_name, 'Sortino Model') as strategy_name,
        COALESCE(allow_shorting, FALSE) as allow_shorting,
        COALESCE(cash_mode, 'SETTLED') as cash_mode,
        COALESCE(CAST(capital_utilization AS FLOAT), 1.0) as capital_utilization,
        COALESCE(allow_overnight, TRUE) as allow_overnight,
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
      // If account_id was provided but not found, return a more specific message
      if (account_id) {
        return res.status(404).json({
          account_name: 'Account Not Found',
          bot_name: 'ALPHA-01',
          account_type_display: 'CASH',
          strategy_name: "Sortino Model",
          allow_shorting: false,
          cash_mode: 'SETTLED',
          capital_utilization: 1.0,
          allow_overnight: true,
          api_status: 'DISCONNECTED',
          active_model_display: null,
          models_active: {},
          error: `Account with ID "${account_id}" not found in database. Please add it in Settings.`
        });
      }
      // No account_id provided and no accounts in database
      return res.status(200).json({
        account_name: 'STANDARD STRATEGY',
        bot_name: 'ALPHA-01',
        account_type_display: 'CASH',
        strategy_name: "Sortino Model",
        allow_shorting: false,
        cash_mode: 'SETTLED',
        capital_utilization: 1.0,
        allow_overnight: true,
        api_status: 'DISCONNECTED',
        active_model_display: null,
        models_active: {},
      });
    }

    const account = result.rows[0];
    
    // Use extended columns if available, otherwise use defaults
    const bot_name = account.bot_name !== undefined ? account.bot_name : 'ALPHA-01';
    const account_type_display = account.account_type_display !== undefined ? account.account_type_display : 'CASH';
    const strategy_name = account.strategy_name !== undefined ? account.strategy_name : "Sortino Model";
    const allow_shorting = account.allow_shorting !== undefined ? account.allow_shorting : false;
    const cash_mode = account.cash_mode !== undefined ? account.cash_mode : 'SETTLED';
    const capital_utilization = account.capital_utilization !== undefined ? account.capital_utilization : 1.0;
    const allow_overnight = account.allow_overnight !== undefined ? account.allow_overnight : true;
    
    // Check API status by attempting to connect to Alpaca
    let apiStatus = 'CONNECTED';
    let apiError = null;
    try {
      if (!account.api_key || !account.secret_key) {
        apiStatus = 'DISCONNECTED';
        apiError = 'API credentials missing';
      } else {
        // Decrypt the API keys before using them
        const decryptedApiKey = decrypt(account.api_key);
        const decryptedSecretKey = decrypt(account.secret_key);
        
        const baseUrl = account.type === 'Paper' 
          ? 'https://paper-api.alpaca.markets' 
          : 'https://api.alpaca.markets';
        
        // Test connection using fetch with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        try {
          const response = await fetch(`${baseUrl}/v2/account`, {
            headers: {
              'APCA-API-KEY-ID': decryptedApiKey,
              'APCA-API-SECRET-KEY': decryptedSecretKey
            },
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            apiStatus = 'DISCONNECTED';
            if (response.status === 401) {
              apiError = 'Invalid API credentials';
            } else if (response.status === 403) {
              apiError = 'API access forbidden';
            } else {
              apiError = `API error: ${response.status}`;
            }
          }
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          if (fetchErr.name === 'AbortError') {
            apiStatus = 'DISCONNECTED';
            apiError = 'Connection timeout';
          } else {
            throw fetchErr;
          }
        }
      }
    } catch (err) {
      apiStatus = 'DISCONNECTED';
      apiError = err.message || 'Connection failed';
      safeLogError('API status check error:', err);
    }

    const models_active = await fetchActiveModelVersions(pool);
    const active_model_display = activeModelDisplayForAccount(strategy_name, models_active);

    res.status(200).json({
      account_name: account.name || 'STANDARD STRATEGY',
      bot_name: bot_name,
      account_type_display: account_type_display,
      strategy_name: strategy_name,
      allow_shorting: allow_shorting,
      cash_mode: cash_mode,
      capital_utilization: capital_utilization,
      allow_overnight: allow_overnight,
      api_status: apiStatus,
      api_error: apiError || null,
      active_model_display,
      models_active,
    });
  } catch (err) {
    safeLogError('Database error (GET):', err);
    res.status(500).json({ error: 'Internal server error', details: err?.message });
  }
}
