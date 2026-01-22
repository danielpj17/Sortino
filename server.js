import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- NEW: Filtered Stats Endpoint ---
app.get('/api/stats/:type', async (req, res) => {
  const { type } = req.params; // 'Paper' or 'Live'
  try {
    // Join trades with accounts to filter by type
    const query = `
      SELECT 
        SUM(t.pnl) as total_pnl, 
        COUNT(*) as total_trades,
        SUM(CASE WHEN t.pnl > 0 THEN 1 ELSE 0 END) as wins
      FROM trades t
      JOIN accounts a ON t.account_id = a.id
      WHERE a.type = $1
    `;
    const result = await pool.query(query, [type]);
    const row = result.rows[0];

    const totalTrades = parseInt(row.total_trades || 0);
    const wins = parseInt(row.wins || 0);
    
    res.json({
      totalPnL: parseFloat(row.total_pnl || 0),
      winRate: totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0,
      totalTrades: totalTrades
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database Error' });
  }
});

// --- NEW: Filtered Trades Endpoint ---
app.get('/api/trades/:type', async (req, res) => {
  const { type } = req.params;
  try {
    const result = await pool.query(`
      SELECT t.*, a.name as account_name 
      FROM trades t 
      JOIN accounts a ON t.account_id = a.id 
      WHERE a.type = $1 
      ORDER BY t.timestamp DESC 
      LIMIT 100
    `, [type]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Global trades endpoint (all trades)
app.get('/api/trades', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, a.name as account_name 
      FROM trades t 
      JOIN accounts a ON t.account_id = a.id 
      ORDER BY t.timestamp DESC 
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Serve static files from the Vite build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  
  // Handle React routing - return index.html for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    } else {
      res.status(404).json({ error: 'API endpoint not found' });
    }
  });
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  if (process.env.NODE_ENV === 'production') {
    console.log('Serving production build');
  }
});