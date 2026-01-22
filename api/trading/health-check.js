/**
 * GET /api/trading/health-check – Heartbeat endpoint for cron (e.g. cron-job.org).
 * Finds all accounts with is_running OR always_on, runs executeTradingLoop for each.
 */

import { getPool } from '../db.js';
import { executeTradingLoop } from './loop.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
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
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT account_id FROM bot_state WHERE is_running = TRUE OR always_on = TRUE`
    );

    if (rows.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'No active bots',
        bots_processed: 0,
      });
    }

    const results = [];
    for (const { account_id } of rows) {
      try {
        const out = await executeTradingLoop(account_id);
        results.push({ account_id, status: 'success', ...out });
      } catch (e) {
        results.push({
          account_id,
          status: 'error',
          error: e.message,
        });
      }
    }

    return res.status(200).json({
      status: 'ok',
      bots_processed: rows.length,
      results,
    });
  } catch (e) {
    console.error('Health check error:', e);
    return res.status(500).json({ error: e.message });
  }
}
