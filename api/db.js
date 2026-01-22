import pg from 'pg';
import { safeLogError } from './safeLog.js';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    // Parse DATABASE_URL and ensure sslmode is explicitly set to avoid warnings
    let connectionString = process.env.DATABASE_URL;
    
    if (connectionString) {
      // Replace any existing sslmode with verify-full for security
      if (connectionString.includes('sslmode=')) {
        connectionString = connectionString.replace(/[?&]sslmode=[^&]*/, '');
      }
      // Add sslmode=verify-full explicitly
      const separator = connectionString.includes('?') ? '&' : '?';
      connectionString = `${connectionString}${separator}sslmode=verify-full`;
    }
    
    pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    pool.on('error', (err) => safeLogError('[pool]', err));
  }
  return pool;
}
