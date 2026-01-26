/**
 * /api/trading
 * GET ?account_id=1 – Bot status for account (is_running, always_on, last_heartbeat).
 * GET ?health-check=true – Heartbeat endpoint for cron (runs trading loops for all active bots).
 * POST { account_id, action: 'start'|'stop' } – Start or stop bot; start runs one loop immediately.
 */

import { getPool } from '../db.js';
import { executeTradingLoop } from './loop.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    // Handle health-check endpoint (merged from trading/health-check.js)
    if (req.query?.['health-check'] === 'true' || req.query?.health_check === 'true') {
      try {
        const pool = getPool();
        
        // First, clean up orphaned bot_state records (account_ids that don't exist in accounts)
        try {
          const cleanupResult = await pool.query(
            `DELETE FROM bot_state 
             WHERE account_id NOT IN (SELECT id FROM accounts)`
          );
          if (cleanupResult.rowCount > 0) {
            console.log(`[trading] Cleaned up ${cleanupResult.rowCount} orphaned bot_state record(s)`);
          }
        } catch (cleanupError) {
          // Log but don't fail - cleanup is best effort
          console.warn('[trading] Cleanup warning:', cleanupError.message);
        }

        // Use JOIN to ensure we only get bot_state records with valid account_ids
        const { rows } = await pool.query(
          `SELECT bs.account_id 
           FROM bot_state bs
           INNER JOIN accounts a ON bs.account_id = a.id
           WHERE bs.is_running = TRUE OR bs.always_on = TRUE`
        );

        // #region agent log
        fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/index.js:43',message:'Health-check: active bots query',data:{activeBotsCount:rows.length,accountIds:rows.map(r=>r.account_id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion

        if (rows.length === 0) {
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/index.js:51',message:'Health-check: no active bots found',data:{reason:'is_running or always_on not set'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          return res.status(200).json({
            status: 'ok',
            message: 'No active bots',
            bots_processed: 0,
          });
        }

        const results = [];
        for (const { account_id } of rows) {
          try {
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/index.js:61',message:'Health-check: executing trading loop',data:{account_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
            // #endregion
            const out = await executeTradingLoop(account_id);
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/index.js:63',message:'Health-check: trading loop completed',data:{account_id,success:out.success,skipped:out.skipped,reason:out.reason,resultsCount:out.results?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
            // #endregion
            results.push({ account_id, status: 'success', ...out });
          } catch (e) {
            // #region agent log
            fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'trading/index.js:66',message:'Health-check: trading loop error',data:{account_id,error:e.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
            // #endregion
            console.error(`[trading] Error processing account ${account_id}:`, e.message);
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
        console.error('[trading] Health check fatal error:', e);
        const msg = e.message || '';
        if (msg.includes('relation "bot_state" does not exist') || msg.includes('relation \'bot_state\' does not exist')) {
          return res.status(503).json({
            error: 'Database migration required',
            hint: 'Run the bot_state schema in Neon SQL Editor. See HEARTBEAT_SETUP.md Step 1.',
          });
        }
        // Check for foreign key constraint violations
        if (msg.includes('foreign key constraint') || msg.includes('violates foreign key')) {
          console.error('[trading] Foreign key constraint error - attempting cleanup');
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

    // Normal GET - bot status for account
    const accountId = req.query?.account_id;
    if (!accountId) {
      return res.status(400).json({ 
        error: 'account_id required',
        message: 'Please provide an account_id query parameter',
      });
    }
    try {
      const pool = getPool();
      
      // First verify account exists
      const accountCheck = await pool.query(
        `SELECT id FROM accounts WHERE id = $1`,
        [accountId]
      );

      if (accountCheck.rows.length === 0) {
        // Account doesn't exist - clean up any orphaned bot_state record
        try {
          await pool.query(
            `DELETE FROM bot_state WHERE account_id = $1`,
            [accountId]
          );
        } catch (cleanupErr) {
          // Ignore cleanup errors
        }
        return res.status(404).json({
          error: 'Account not found',
          account_id: accountId,
          message: `Account with ID "${accountId}" does not exist.`,
        });
      }

      // Use JOIN to ensure we only get valid bot_state records
      const { rows } = await pool.query(
        `SELECT bs.is_running, bs.always_on, bs.last_heartbeat, bs.last_error, bs.updated_at
         FROM bot_state bs
         INNER JOIN accounts a ON bs.account_id = a.id
         WHERE bs.account_id = $1`,
        [accountId]
      );
      
      if (rows.length === 0) {
        return res.status(200).json({
          account_id: accountId,
          is_running: false,
          always_on: false,
          last_heartbeat: null,
          last_error: null,
          updated_at: null,
        });
      }
      
      const r = rows[0];
      return res.status(200).json({
        account_id: accountId,
        is_running: !!r.is_running,
        always_on: !!r.always_on,
        last_heartbeat: r.last_heartbeat?.toISOString?.() ?? null,
        last_error: r.last_error ?? null,
        updated_at: r.updated_at?.toISOString?.() ?? null,
      });
    } catch (e) {
      console.error(`[trading] GET error for account ${accountId}:`, e);
      const msg = e.message || '';
      if (msg.includes('foreign key constraint') || msg.includes('violates foreign key')) {
        // Try to clean up orphaned record
        try {
          const pool = getPool();
          await pool.query(
            `DELETE FROM bot_state WHERE account_id = $1`,
            [accountId]
          );
        } catch (cleanupErr) {
          // Ignore cleanup errors
        }
        return res.status(200).json({
          account_id: accountId,
          is_running: false,
          always_on: false,
          last_heartbeat: null,
          last_error: null,
          updated_at: null,
          warning: 'Orphaned bot_state record was cleaned up',
        });
      }
      return res.status(500).json({ 
        error: e.message || 'Internal server error',
        account_id: accountId,
      });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }

  const { account_id, action } = body || {};
  const accountId = account_id;

  if (!accountId) {
    return res.status(400).json({ error: 'account_id required' });
  }

  if (action !== 'start' && action !== 'stop') {
    return res.status(400).json({ error: 'action must be "start" or "stop"' });
  }

  try {
    const pool = getPool();

    // Validate account exists before any bot_state operations
    const accountCheck = await pool.query(
      `SELECT id FROM accounts WHERE id = $1`,
      [accountId]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Account not found',
        account_id: accountId,
        message: `Account with ID "${accountId}" does not exist in the database.`,
      });
    }

    if (action === 'start') {
      try {
        await pool.query(
          `INSERT INTO bot_state (account_id, is_running, always_on, last_heartbeat, updated_at)
           VALUES ($1, TRUE, TRUE, NOW(), NOW())
           ON CONFLICT (account_id)
           DO UPDATE SET is_running = TRUE, always_on = TRUE, last_heartbeat = NOW(), updated_at = NOW()`,
          [accountId]
        );

        try {
          await executeTradingLoop(accountId);
        } catch (e) {
          console.error(`[trading] Initial trading loop error for account ${accountId}:`, e.message);
          return res.status(500).json({
            error: 'Bot started but initial loop failed',
            account_id: accountId,
            details: e.message,
          });
        }

        return res.status(200).json({ 
          success: true, 
          message: 'Bot started',
          account_id: accountId,
        });
      } catch (e) {
        console.error(`[trading] Start bot error for account ${accountId}:`, e);
        const msg = e.message || '';
        if (msg.includes('foreign key constraint') || msg.includes('violates foreign key')) {
          // Clean up orphaned record if it exists
          try {
            await pool.query(
              `DELETE FROM bot_state WHERE account_id = $1 AND account_id NOT IN (SELECT id FROM accounts)`,
              [accountId]
            );
          } catch (cleanupErr) {
            // Ignore cleanup errors
          }
          return res.status(500).json({
            error: 'Database integrity issue',
            account_id: accountId,
            message: 'Foreign key constraint violation. The account may have been deleted.',
          });
        }
        throw e;
      }
    }

    if (action === 'stop') {
      try {
        const updateResult = await pool.query(
          `UPDATE bot_state 
           SET is_running = FALSE, always_on = FALSE, updated_at = NOW() 
           WHERE account_id = $1`,
          [accountId]
        );

        // If no rows were updated, the bot_state record doesn't exist (which is fine)
        if (updateResult.rowCount === 0) {
          return res.status(200).json({ 
            success: true, 
            message: 'Bot already stopped or never started',
            account_id: accountId,
          });
        }

        return res.status(200).json({ 
          success: true, 
          message: 'Bot stopped',
          account_id: accountId,
        });
      } catch (e) {
        console.error(`[trading] Stop bot error for account ${accountId}:`, e);
        const msg = e.message || '';
        if (msg.includes('foreign key constraint') || msg.includes('violates foreign key')) {
          // Clean up orphaned record
          try {
            await pool.query(
              `DELETE FROM bot_state WHERE account_id = $1`,
              [accountId]
            );
            return res.status(200).json({
              success: true,
              message: 'Bot stopped (orphaned record cleaned up)',
              account_id: accountId,
              warning: 'An orphaned bot_state record was removed',
            });
          } catch (cleanupErr) {
            return res.status(500).json({
              error: 'Database integrity issue',
              account_id: accountId,
              message: 'Foreign key constraint violation. Unable to stop bot.',
            });
          }
        }
        throw e;
      }
    }
  } catch (e) {
    console.error(`[trading] Route error for account ${accountId || 'unknown'}:`, e);
    return res.status(500).json({ 
      error: e.message || 'Internal server error',
      account_id: accountId,
    });
  }
}
