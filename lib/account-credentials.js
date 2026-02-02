import { getPool } from './db.js';
import { decrypt } from './encryption.js';

/**
 * Get decrypted account credentials for internal use (trading loop, Python engine, etc.)
 * This function should only be used server-side, never exposed to the frontend
 * @param {string} accountId - The account ID
 * @returns {Promise<Object>} - Account object with decrypted api_key and secret_key
 */
export async function getDecryptedAccount(accountId) {
  const pool = getPool();
  
  const result = await pool.query(
    `SELECT id, name, api_key, secret_key, type,
            COALESCE(allow_shorting, FALSE) AS allow_shorting,
            COALESCE(CAST(max_position_size AS FLOAT), 0.4) AS max_position_size,
            COALESCE(strategy_name, 'Sortino Model') AS strategy_name,
            COALESCE(account_type_display, 'CASH') AS account_type_display
     FROM accounts WHERE id = $1`,
    [accountId]
  );
  
  if (result.rows.length === 0) {
    throw new Error(`Account ${accountId} not found`);
  }
  
  const account = result.rows[0];
  
  // Decrypt the keys
  return {
    ...account,
    api_key: decrypt(account.api_key),
    secret_key: decrypt(account.secret_key)
  };
}

/**
 * Get all decrypted accounts for internal use
 * @returns {Promise<Array>} - Array of account objects with decrypted credentials
 */
export async function getAllDecryptedAccounts() {
  const pool = getPool();
  
  const result = await pool.query(
    `SELECT id, name, api_key, secret_key, type,
            COALESCE(allow_shorting, FALSE) AS allow_shorting,
            COALESCE(CAST(max_position_size AS FLOAT), 0.4) AS max_position_size,
            COALESCE(strategy_name, 'Sortino Model') AS strategy_name,
            COALESCE(account_type_display, 'CASH') AS account_type_display
     FROM accounts`
  );
  
  return result.rows.map(account => ({
    ...account,
    api_key: decrypt(account.api_key),
    secret_key: decrypt(account.secret_key)
  }));
}
