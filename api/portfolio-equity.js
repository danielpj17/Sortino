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

  const { type, account_id, range } = req.query;

  try {
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set');
      return res.status(500).json({ data: [], currentEquity: 0, startingEquity: 0 });
    }

    const pool = getPool();
    
    // Get starting capital (default: 100000 for Paper, 10000 for Live)
    const startingCapital = type === 'Paper' ? 100000 : 10000;
    
    // Determine time interval based on range
    let timeInterval = 'hour'; // Default for 1D
    if (range === '1D') {
      timeInterval = 'hour';
    } else if (range === '1W' || range === '1M') {
      timeInterval = 'day';
    } else if (range === '1Y' || range === 'YTD') {
      timeInterval = 'month';
    }
    
    // Build query to get all trades ordered by time
    let query = `
      SELECT 
        t.timestamp,
        t.pnl,
        DATE_TRUNC('${timeInterval}', t.timestamp) as time_bucket
      FROM trades t
      JOIN accounts a ON t.account_id = a.id
      WHERE a.type = $1
    `;
    
    const params = [type];
    
    // Add account_id filter if provided
    if (account_id) {
      query += ` AND t.account_id = $2`;
      params.push(account_id);
    }
    
    query += ` ORDER BY t.timestamp`;
    
    const result = await pool.query(query, params);
    
    // Calculate cumulative PnL grouped by time bucket
    const bucketMap = new Map();
    let cumulativePnL = 0;
    
    for (const row of result.rows) {
      cumulativePnL += parseFloat(row.pnl || 0);
      const bucketKey = new Date(row.time_bucket).toISOString();
      
      if (!bucketMap.has(bucketKey)) {
        bucketMap.set(bucketKey, {
          time: bucketKey,
          cumulativePnL: cumulativePnL
        });
      } else {
        bucketMap.set(bucketKey, {
          time: bucketKey,
          cumulativePnL: cumulativePnL
        });
      }
    }
    
    // Convert map to array and sort by time
    const dataPoints = Array.from(bucketMap.values()).sort((a, b) => 
      new Date(a.time).getTime() - new Date(b.time).getTime()
    );
    
    // Get current total PnL
    let currentPnLQuery = `
      SELECT SUM(t.pnl) as total_pnl
      FROM trades t
      JOIN accounts a ON t.account_id = a.id
      WHERE a.type = $1
    `;
    const currentPnLParams = [type];
    
    if (account_id) {
      currentPnLQuery += ` AND t.account_id = $2`;
      currentPnLParams.push(account_id);
    }
    
    const currentPnLResult = await pool.query(currentPnLQuery, currentPnLParams);
    const currentPnL = parseFloat(currentPnLResult.rows[0]?.total_pnl || 0);
    const currentEquity = startingCapital + currentPnL;
    
    // Format data based on range
    const formattedData = dataPoints.map(point => {
      const date = new Date(point.time);
      let timeLabel = '';
      
      if (range === '1D') {
        timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      } else if (range === '1W') {
        timeLabel = date.toLocaleDateString('en-US', { weekday: 'short' });
      } else if (range === '1M') {
        timeLabel = date.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
      } else if (range === '1Y') {
        timeLabel = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      } else if (range === 'YTD') {
        timeLabel = date.toLocaleDateString('en-US', { month: 'short' });
      } else {
        timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
      
      const equity = startingCapital + point.cumulativePnL;
      return {
        time: timeLabel,
        value: Math.round(equity)
      };
    });
    
    // If no data, return at least current equity
    if (formattedData.length === 0) {
      formattedData.push({
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        value: currentEquity
      });
    }
    
    res.status(200).json({
      data: formattedData,
      currentEquity: Math.round(currentEquity),
      startingEquity: startingCapital
    });
  } catch (err) {
    safeLogError('Database error:', err);
    res.status(500).json({ data: [], currentEquity: 0, startingEquity: 0 });
  }
}
