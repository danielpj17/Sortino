import pg from 'pg';
import { safeLogError } from './safeLog.js';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    pool.on('error', (err) => safeLogError('[pool]', err));
  }
  return pool;
}
