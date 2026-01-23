import pg from 'pg';
import { safeLogError } from './safeLog.js';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    // Parse DATABASE_URL and ensure sslmode is explicitly set to avoid warnings
    let connectionString = process.env.DATABASE_URL;
    
    if (connectionString) {
      try {
        // Use URL API to properly parse the connection string
        const url = new URL(connectionString);
        
        // Remove existing sslmode and channel_binding if present
        url.searchParams.delete('sslmode');
        url.searchParams.delete('channel_binding');
        
        // Add sslmode=require (Neon requires this, verify-full might be too strict)
        url.searchParams.set('sslmode', 'require');
        
        // Reconstruct the connection string
        connectionString = url.toString();
      } catch (error) {
        // Fallback to string manipulation if URL parsing fails
        console.warn('Failed to parse DATABASE_URL as URL, using string manipulation:', error);
        // Replace any existing sslmode with require
        if (connectionString.includes('sslmode=')) {
          connectionString = connectionString.replace(/[?&]sslmode=[^&]*/, '');
        }
        // Remove channel_binding if it's causing issues
        connectionString = connectionString.replace(/[?&]channel_binding=[^&]*/, '');
        // Add sslmode=require explicitly
        const separator = connectionString.includes('?') ? '&' : '?';
        connectionString = `${connectionString}${separator}sslmode=require`;
      }
    }
    
    pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    pool.on('error', (err) => safeLogError('[pool]', err));
  }
  return pool;
}
