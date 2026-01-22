import pg from 'pg';
const { Pool } = pg;

// Create a single connection pool (reused across serverless functions)
let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}
