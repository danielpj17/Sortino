/**
 * /api/trading
 * GET ?account_id=1 – Bot status for account (is_running, always_on, last_heartbeat).
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
    const accountId = req.query?.account_id;
    if (!accountId) {
      return res.status(400).json({ error: 'account_id required' });
    }
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT is_running, always_on, last_heartbeat, last_error, updated_at
         FROM bot_state WHERE account_id = $1`,
        [accountId]
      );
      if (rows.length === 0) {
        return res.status(200).json({
          account_id: accountId,
          is_running: false,
          always_on: false,
          last_heartbeat: null,
          last_error: null,
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
      console.error('GET /api/trading:', e);
      return res.status(500).json({ error: e.message });
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

    if (action === 'start') {
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
        console.error('Initial trading loop error:', e);
        return res.status(500).json({
          error: 'Bot started but initial loop failed',
          details: e.message,
        });
      }

      return res.status(200).json({ success: true, message: 'Bot started' });
    }

    if (action === 'stop') {
      await pool.query(
        `UPDATE bot_state SET is_running = FALSE, always_on = FALSE, updated_at = NOW() WHERE account_id = $1`,
        [accountId]
      );
      return res.status(200).json({ success: true, message: 'Bot stopped' });
    }
  } catch (e) {
    console.error('Trading route error:', e);
    return res.status(500).json({ error: e.message });
  }
}
