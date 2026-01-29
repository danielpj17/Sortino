import { getPool } from '../lib/db.js';
import { encrypt } from '../lib/encryption.js';
import { getDecryptedAccount, getAllDecryptedAccounts } from '../lib/account-credentials.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    return res.status(500).json({ error: 'Database not configured' });
  }

  const pool = getPool();

  // Handle GET - list all accounts (never return encrypted keys to frontend)
  // Special case: if ?decrypt=true is provided, return decrypted credentials (internal use only)
  if (req.method === 'GET') {
    // Check if this is a request for decrypted credentials (internal use)
    const { decrypt: wantDecrypted, account_id } = req.query;
    
    if (wantDecrypted === 'true') {
      // Security: Only allow from localhost or with proper authentication
      const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
      const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost' || !clientIp;
      
      if (!isLocalhost && process.env.NODE_ENV === 'production') {
        const authToken = req.headers['authorization'];
        if (authToken !== `Bearer ${process.env.INTERNAL_API_TOKEN}`) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }
      
      try {
        if (account_id) {
          const account = await getDecryptedAccount(account_id);
          return res.status(200).json(account);
        } else {
          const accounts = await getAllDecryptedAccounts();
          return res.status(200).json(accounts);
        }
      } catch (err) {
        console.error('[accounts] GET decrypted error:', err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
    
    // Normal GET - return account metadata only (no keys)
    try {
      const result = await pool.query(`
        SELECT id, name, type, created_at
        FROM accounts
        ORDER BY type, name
      `);
      res.status(200).json(result.rows || []);
    } catch (err) {
      console.error('[accounts] GET error:', err);
      res.status(500).json([]);
    }
    return;
  }

  // Handle POST - create new account (encrypt keys before storing)
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          return res.status(400).json({ error: 'Invalid JSON' });
        }
      }

      const { id, name, type, api_key, secret_key } = body;

      if (!id || !name || !type || !api_key || !secret_key) {
        return res.status(400).json({ 
          error: 'Missing required fields',
          required: ['id', 'name', 'type', 'api_key', 'secret_key']
        });
      }

      // Encrypt the API keys before storing
      const encryptedApiKey = encrypt(api_key);
      const encryptedSecretKey = encrypt(secret_key);

      // Insert or update account with encrypted keys
      await pool.query(
        `INSERT INTO accounts (id, name, type, api_key, secret_key, created_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
         ON CONFLICT (id)
         DO UPDATE SET 
           name = EXCLUDED.name,
           type = EXCLUDED.type,
           api_key = EXCLUDED.api_key,
           secret_key = EXCLUDED.secret_key`,
        [id, name, type, encryptedApiKey, encryptedSecretKey, null] // null uses DEFAULT
      );

      res.status(200).json({ success: true, account_id: id });
    } catch (err) {
      console.error('[accounts] POST error:', err);
      res.status(500).json({ error: err.message || 'Failed to create account' });
    }
    return;
  }

  // Handle DELETE - remove account
  if (req.method === 'DELETE') {
    try {
      const accountId = req.query?.id || req.body?.id;
      if (!accountId) {
        return res.status(400).json({ error: 'account id required' });
      }

      await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error('[accounts] DELETE error:', err);
      res.status(500).json({ error: err.message || 'Failed to delete account' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
