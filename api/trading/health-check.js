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
    
    // First, clean up orphaned bot_state records (account_ids that don't exist in accounts)
    try {
      const cleanupResult = await pool.query(
        `DELETE FROM bot_state 
         WHERE account_id NOT IN (SELECT id FROM accounts)`
      );
      if (cleanupResult.rowCount > 0) {
        console.log(`[health-check] Cleaned up ${cleanupResult.rowCount} orphaned bot_state record(s)`);
      }
    } catch (cleanupError) {
      // Log but don't fail - cleanup is best effort
      console.warn('[health-check] Cleanup warning:', cleanupError.message);
    }

    // Use JOIN to ensure we only get bot_state records with valid account_ids
    const { rows } = await pool.query(
      `SELECT bs.account_id 
       FROM bot_state bs
       INNER JOIN accounts a ON bs.account_id = a.id
       WHERE bs.is_running = TRUE OR bs.always_on = TRUE`
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
        console.error(`[health-check] Error processing account ${account_id}:`, e.message);
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
    console.error('[health-check] Fatal error:', e);
    const msg = e.message || '';
    if (msg.includes('relation "bot_state" does not exist') || msg.includes('relation \'bot_state\' does not exist')) {
      return res.status(503).json({
        error: 'Database migration required',
        hint: 'Run the bot_state schema in Neon SQL Editor. See HEARTBEAT_SETUP.md Step 1.',
      });
    }
    // Check for foreign key constraint violations
    if (msg.includes('foreign key constraint') || msg.includes('violates foreign key')) {
      console.error('[health-check] Foreign key constraint error - attempting cleanup');
      // Try to clean up and return a warning instead of error
      try {
        const pool = getPool();
        await pool.query(
          `DELETE FROM bot_state 
           WHERE account_id NOT IN (SELECT id FROM accounts)`
        );
        return res.status(200).json({
          status: 'ok',
          message: 'Health check completed after cleanup',
          bots_processed: 0,
          warning: 'Orphaned bot_state records were cleaned up',
        });
      } catch (cleanupErr) {
        return res.status(500).json({
          error: 'Database integrity issue detected',
          details: 'Foreign key constraint violation. Please check bot_state table for orphaned records.',
        });
      }
    }
    return res.status(500).json({ error: e.message });
  }
}
