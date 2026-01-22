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
      return res.status(500).json({ totalPnL: 0, winRate: 0, totalTrades: 0 });
    }

    const pool = getPool();
    const query = `
      SELECT 
        SUM(t.pnl) as total_pnl, 
        COUNT(*) as total_trades,
        SUM(CASE WHEN t.pnl > 0 THEN 1 ELSE 0 END) as wins
      FROM trades t
      JOIN accounts a ON t.account_id = a.id
    `;
    const result = await pool.query(query);
    const row = result.rows[0];

    const totalTrades = parseInt(row.total_trades || 0);
    const wins = parseInt(row.wins || 0);
    
    res.status(200).json({
      totalPnL: parseFloat(row.total_pnl || 0),
      winRate: totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0,
      totalTrades: totalTrades
    });
  } catch (err) {
    console.error('Database error:', err);
    // Return default stats instead of error object
    res.status(500).json({ totalPnL: 0, winRate: 0, totalTrades: 0 });
  }
}
