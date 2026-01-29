import { getPool } from '../lib/db.js';
import { safeLogError } from '../lib/safeLog.js';

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
    `;
    const params = [];
    
    // Add type filter if provided (from stats/[type].js)
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
    
    const result = await pool.query(query, params);
    const row = result.rows[0];

    const totalTrades = parseInt(row.total_trades || 0);
    const wins = parseInt(row.wins || 0);
    
    const response = {
      totalPnL: parseFloat(row.total_pnl || 0),
      winRate: totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0,
      totalTrades: totalTrades
    };

    // If equity data is requested, fetch it (from stats/[type].js)
    if (includeEquity === 'true') {
      const startingCapital = type === 'Paper' ? 100000 : 10000;
      
      // Calculate time range boundaries
      const now = new Date();
      let startTime = new Date();
      
      if (range === '1D') {
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      } else if (range === '1W') {
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (range === '1M') {
        startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (range === '1Y') {
        startTime = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      } else if (range === 'YTD') {
        startTime = new Date(now.getFullYear(), 0, 1);
      }
      
      // For 1D view, get all individual trades (not bucketed) to show continuous changes
      // For other ranges, use time buckets
      let timeInterval = null;
      if (range === '1D') {
        // Don't bucket for 1D - we want individual trade points
        timeInterval = null;
      } else if (range === '1W' || range === '1M') {
        timeInterval = 'day';
      } else if (range === '1Y' || range === 'YTD') {
        timeInterval = 'month';
      }
      
      // Build query to get all trades ordered by time
      let equityQuery = `
        SELECT 
          t.timestamp,
          t.pnl
      `;
      
      if (timeInterval) {
        equityQuery += `, DATE_TRUNC('${timeInterval}', t.timestamp) as time_bucket`;
      }
      
      equityQuery += `
        FROM trades t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.timestamp >= $1
      `;
      
      const equityParams = [startTime.toISOString()];
      
      if (type) {
        equityQuery += ` AND a.type = $${equityParams.length + 1}`;
        equityParams.push(type);
      }
      
      // Add account_id filter if provided
      if (account_id) {
        equityQuery += ` AND t.account_id = $${equityParams.length + 1}`;
        equityParams.push(account_id);
      }
      
      equityQuery += ` ORDER BY t.timestamp`;
      
      const equityResult = await pool.query(equityQuery, equityParams);
      
      // Build data points with cumulative PnL
      const tradePoints = [];
      let cumulativePnL = 0;
      
      if (range === '1D') {
        // For 1D: Use individual trade timestamps for precise points
        for (const row of equityResult.rows) {
          cumulativePnL += parseFloat(row.pnl || 0);
          tradePoints.push({
            time: new Date(row.timestamp).toISOString(),
            cumulativePnL: cumulativePnL
          });
        }
      } else {
        // For other ranges: Group by time bucket
        const bucketMap = new Map();
        for (const row of equityResult.rows) {
          cumulativePnL += parseFloat(row.pnl || 0);
          const bucketKey = new Date(row.time_bucket).toISOString();
          
          // Keep the latest cumulative PnL for each bucket
          bucketMap.set(bucketKey, {
            time: bucketKey,
            cumulativePnL: cumulativePnL
          });
        }
        
        tradePoints.push(...Array.from(bucketMap.values()));
        tradePoints.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      }
      
      // Build the final data array
      const formattedData = [];
      
      // Add starting point
      formattedData.push({
        time: startTime.toISOString(),
        value: startingCapital
      });
      
      // Add trade points
      for (const point of tradePoints) {
        const equity = startingCapital + point.cumulativePnL;
        formattedData.push({
          time: point.time,
          value: Math.round(equity)
        });
      }
      
      // For 1D view, add intermediate hourly points to show progression
      if (range === '1D' && formattedData.length > 1) {
        const hourlyPoints = [];
        const start = new Date(startTime);
        const end = new Date(now);
        
        // Generate hourly points
        let currentHour = new Date(start);
        currentHour.setMinutes(0, 0, 0); // Round to start of hour
        
        while (currentHour <= end) {
          // Find the last trade point before this hour
          let equityAtHour = startingCapital;
          for (let i = formattedData.length - 1; i >= 0; i--) {
            const pointTime = new Date(formattedData[i].time);
            if (pointTime <= currentHour) {
              equityAtHour = formattedData[i].value;
              break;
            }
          }
          
          hourlyPoints.push({
            time: currentHour.toISOString(),
            value: equityAtHour
          });
          
          // Move to next hour
          currentHour = new Date(currentHour.getTime() + 60 * 60 * 1000);
        }
        
        // Merge hourly points with trade points, removing duplicates
        const allPoints = [...formattedData];
        for (const hourlyPoint of hourlyPoints) {
          const exists = allPoints.some(p => {
            const pTime = new Date(p.time);
            const hTime = new Date(hourlyPoint.time);
            return Math.abs(pTime.getTime() - hTime.getTime()) < 5 * 60 * 1000; // Within 5 minutes
          });
          
          if (!exists) {
            allPoints.push(hourlyPoint);
          }
        }
        
        // Sort by time and update formattedData
        allPoints.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
        formattedData.length = 0;
        formattedData.push(...allPoints);
      }
      
      // Always add current point
      const currentEquity = Math.round(startingCapital + response.totalPnL);
      formattedData.push({
        time: now.toISOString(),
        value: currentEquity
      });
      
      // Remove duplicates (same time)
      const uniqueData = [];
      const seenTimes = new Set();
      for (const point of formattedData) {
        const timeKey = new Date(point.time).toISOString();
        if (!seenTimes.has(timeKey)) {
          seenTimes.add(timeKey);
          uniqueData.push(point);
        }
      }
      
      // Sort final data
      uniqueData.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      
      response.equityData = uniqueData;
      response.currentEquity = currentEquity;
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
