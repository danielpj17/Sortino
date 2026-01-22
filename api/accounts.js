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
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set');
      return res.status(500).json([]);
    }

    const pool = getPool();
    const result = await pool.query(`
      SELECT id, name, type
      FROM accounts
      ORDER BY type, name
    `);
    res.status(200).json(result.rows || []);
  } catch (err) {
    console.error('Database error:', err);
    // Return empty array instead of error object
    res.status(500).json([]);
  }
}
