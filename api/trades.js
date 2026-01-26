import { getPool } from './db.js';
import { safeLogError } from './safeLog.js';

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

  const { type, account_id } = req.query;

  try {
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set');
      return res.status(500).json([]);
    }

    const pool = getPool();
    let query = `
      SELECT t.*, a.name as account_name 
      FROM trades t 
      JOIN accounts a ON t.account_id = a.id
    `;
    const params = [];
    
    // Add type filter if provided (from trades/[type].js)
    if (type) {
      query += ` WHERE a.type = $1`;
      params.push(type);
    }
    
    // Add account_id filter if provided
    if (account_id) {
      if (params.length === 0) {
        query += ` WHERE t.account_id = $1`;
      } else {
        query += ` AND t.account_id = $${params.length + 1}`;
      }
      params.push(account_id);
    }
    
    query += ` ORDER BY t.timestamp DESC LIMIT 100`;
    
    const result = await pool.query(query, params);
    res.status(200).json(result.rows || []);
  } catch (err) {
    safeLogError('Database error:', err);
    res.status(500).json([]);
  }
}
