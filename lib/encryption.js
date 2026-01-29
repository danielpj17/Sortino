import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Get encryption key from environment variable or generate a default (for development only)
 * In production, ENCRYPTION_KEY should be a 32-byte hex string (64 characters)
 */
function getEncryptionKey() {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    // If it's a hex string, convert to buffer
    if (envKey.length === 64) {
      return Buffer.from(envKey, 'hex');
    }
    // Otherwise, derive a key from it using PBKDF2
    return crypto.pbkdf2Sync(envKey, 'sortino-salt', 100000, KEY_LENGTH, 'sha512');
  }
  
  // Development fallback - WARNING: Not secure for production!
  console.warn('[encryption] Using default encryption key. Set ENCRYPTION_KEY environment variable for production!');
  return crypto.pbkdf2Sync('default-dev-key-change-in-production', 'sortino-salt', 100000, KEY_LENGTH, 'sha512');
}

/**
 * Encrypt a plaintext string
 * @param {string} plaintext - The text to encrypt
 * @returns {string} - Base64 encoded encrypted data with IV and auth tag
 */
export function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  
  // Combine IV + tag + encrypted data
  const combined = Buffer.concat([
    iv,
    tag,
    Buffer.from(encrypted, 'base64')
  ]);
  
  return combined.toString('base64');
}

/**
 * Decrypt an encrypted string
 * @param {string} encryptedData - Base64 encoded encrypted data
 * @returns {string} - Decrypted plaintext
 */
export function decrypt(encryptedData) {
  if (!encryptedData) return encryptedData;
  
  // Check if it's already plaintext (for backward compatibility with existing unencrypted data)
  // If it doesn't look like base64 encrypted data, return as-is
  try {
    const combined = Buffer.from(encryptedData, 'base64');
    if (combined.length < IV_LENGTH + TAG_LENGTH) {
      // Too short to be encrypted, likely plaintext
      return encryptedData;
    }
  } catch {
    // Not valid base64, likely plaintext
    return encryptedData;
  }
  
  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedData, 'base64');
    
    if (combined.length < IV_LENGTH + TAG_LENGTH) {
      // Too short, return as plaintext
      return encryptedData;
    }
    
    const iv = combined.slice(0, IV_LENGTH);
    const tag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = combined.slice(IV_LENGTH + TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, null, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // If decryption fails, assume it's plaintext (for backward compatibility)
    console.warn('[encryption] Decryption failed, assuming plaintext:', error.message);
    return encryptedData;
  }
}
