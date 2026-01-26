/**
 * Internal API endpoint for getting decrypted account credentials
 * This should only be used by internal services (Python engine, trading loop)
 * For security, this endpoint should only be accessible from localhost or with proper authentication
 * 
 * In production, consider implementing decryption directly in Python instead of using this endpoint
 */

import { getAllDecryptedAccounts, getDecryptedAccount } from './account-credentials.js';

export default async function handler(req, res) {
  // Security: Only allow from localhost or with proper authentication
  // In production, you should add proper authentication here
  const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
  const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost' || !clientIp;
  
  if (!isLocalhost && process.env.NODE_ENV === 'production') {
    // In production, require authentication token
    const authToken = req.headers['authorization'];
    if (authToken !== `Bearer ${process.env.INTERNAL_API_TOKEN}`) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  // Enable CORS for localhost only
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', isLocalhost ? '*' : 'null');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { account_id } = req.query;

    if (account_id) {
      // Get single account
      const account = await getDecryptedAccount(account_id);
      res.status(200).json(account);
    } else {
      // Get all accounts
      const accounts = await getAllDecryptedAccounts();
      res.status(200).json(accounts);
    }
  } catch (err) {
    console.error('[account-credentials] Error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
