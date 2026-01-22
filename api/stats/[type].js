import { getPool } from '../db.js';
import { safeLogError } from '../safeLog.js';

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

  const { type, account_id, includeEquity, range } = req.query;

  try {
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set');
      if (includeEquity === 'true') {
        return res.status(500).json({ totalPnL: 0, winRate: 0, totalTrades: 0, equityData: [], currentEquity: 0, startingEquity: 0 });
      }
      return res.status(500).json({ totalPnL: 0, winRate: 0, totalTrades: 0 });
    }

    const pool = getPool();
    let query = `
      SELECT 
        SUM(t.pnl) as total_pnl, 
        COUNT(*) as total_trades,
        SUM(CASE WHEN t.pnl > 0 THEN 1 ELSE 0 END) as wins
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
    
    const result = await pool.query(query, params);
    const row = result.rows[0];

    const totalTrades = parseInt(row.total_trades || 0);
    const wins = parseInt(row.wins || 0);
    
    const response = {
      totalPnL: parseFloat(row.total_pnl || 0),
      winRate: totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0,
      totalTrades: totalTrades
    };

    // If equity data is requested, fetch it
    if (includeEquity === 'true') {
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
      let equityQuery = `
        SELECT 
          t.timestamp,
          t.pnl,
          DATE_TRUNC('${timeInterval}', t.timestamp) as time_bucket
        FROM trades t
        JOIN accounts a ON t.account_id = a.id
        WHERE a.type = $1
      `;
      
      const equityParams = [type];
      
      // Add account_id filter if provided
      if (account_id) {
        equityQuery += ` AND t.account_id = $2`;
        equityParams.push(account_id);
      }
      
      equityQuery += ` ORDER BY t.timestamp`;
      
      const equityResult = await pool.query(equityQuery, equityParams);
      
      // Calculate cumulative PnL grouped by time bucket
      const bucketMap = new Map();
      let cumulativePnL = 0;
      
      for (const equityRow of equityResult.rows) {
        cumulativePnL += parseFloat(equityRow.pnl || 0);
        const bucketKey = new Date(equityRow.time_bucket).toISOString();
        
        bucketMap.set(bucketKey, {
          time: bucketKey,
          cumulativePnL: cumulativePnL
        });
      }
      
      // Convert map to array and sort by time
      const dataPoints = Array.from(bucketMap.values()).sort((a, b) => 
        new Date(a.time).getTime() - new Date(b.time).getTime()
      );
      
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
          value: startingCapital + response.totalPnL
        });
      }
      
      response.equityData = formattedData;
      response.currentEquity = Math.round(startingCapital + response.totalPnL);
      response.startingEquity = startingCapital;
    }
    
    res.status(200).json(response);
  } catch (err) {
    safeLogError('Database error:', err);
    if (includeEquity === 'true') {
      res.status(500).json({ totalPnL: 0, winRate: 0, totalTrades: 0, equityData: [], currentEquity: 0, startingEquity: 0 });
    } else {
      res.status(500).json({ totalPnL: 0, winRate: 0, totalTrades: 0 });
    }
  }
}
