/**
 * Health-check endpoint for cron jobs.
 * Path-based route: /api/trading/health-check
 * This file exists to support cron jobs that call the path-based URL.
 */

import tradingHandler from './index.js';

export default async function handler(req, res) {
  // Set health-check query parameter and forward to main handler
  req.query = req.query || {};
  req.query['health-check'] = 'true';
  
  return tradingHandler(req, res);
}
