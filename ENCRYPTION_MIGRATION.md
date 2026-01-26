# Production-Level Encryption Migration

## Overview

The application has been upgraded to use production-level encryption for API keys. All API keys are now encrypted using AES-256-GCM before being stored in the database, and accounts are accessible from any device connected to your database (no longer stored in browser localStorage).

## Changes Made

### 1. Encryption Utility (`api/encryption.js`)
- Created encryption/decryption functions using Node.js crypto with AES-256-GCM
- Supports backward compatibility with existing unencrypted keys
- Uses environment variable `ENCRYPTION_KEY` for the encryption key

### 2. Account Storage (`api/accounts.js`)
- Updated to encrypt API keys before storing in database
- Never returns encrypted keys to frontend (only account metadata)

### 3. Account Credentials Helper (`api/account-credentials.js`)
- Internal helper functions to get decrypted credentials
- Used by trading loop and Python engine

### 4. Trading Loop (`api/trading/loop.js`)
- Updated to use decrypted credentials helper
- Automatically decrypts keys when needed

### 5. Frontend Components
- **Settings.tsx**: Removed localStorage, always fetches from database
- **PaperTrading.tsx**: Removed localStorage, always fetches from database
- **LiveTrading.tsx**: Removed localStorage, always fetches from database
- Updated notice message to reflect production-level encryption

### 6. Python Engine (`python_engine/trade.py`)
- Updated to fetch decrypted credentials from `/api/accounts?decrypt=true` endpoint
- Falls back to database query (with warning) if API is unavailable

### 7. Internal API Endpoint (merged into `api/accounts.js`)
- Added `?decrypt=true` query parameter to `/api/accounts` for internal services
- Returns decrypted credentials when requested with proper authentication
- Only accessible from localhost or with authentication token

## Environment Variables

### Required
- `DATABASE_URL` - PostgreSQL connection string (already required)

### Recommended for Production
- `ENCRYPTION_KEY` - 32-byte hex string (64 characters) for encryption key
  - Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - If not set, uses a default key (not secure for production!)

### Optional
- `API_BASE_URL` - Base URL for API (defaults to `http://localhost:3001`)
- `INTERNAL_API_TOKEN` - Token for accessing internal endpoints in production

## Migration Steps

### For Existing Installations

1. **Set Encryption Key** (if not already set):
   ```bash
   # Generate a secure encryption key
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   
   # Add to .env file
   ENCRYPTION_KEY=<generated-key>
   ```

2. **Re-encrypt Existing Keys**:
   - Existing keys in the database are stored in plaintext
   - When you update an account, it will be automatically encrypted
   - To re-encrypt all accounts, you can:
     - Update each account through the Settings UI (re-enter the keys)
     - Or run a migration script to re-encrypt all existing keys

3. **Update Python Engine**:
   - Ensure `requests` is installed: `pip install requests`
   - Set `API_BASE_URL` in `.env` if your API is not on `localhost:3001`

4. **Test**:
   - Add a new account through Settings
   - Verify it appears in Paper Trading / Live Trading
   - Verify trading loop can access the account
   - Verify Python engine can access the account

## Security Notes

1. **Encryption Key**: Never commit the encryption key to version control. Store it securely in environment variables.

2. **Database Access**: Ensure your database connection is secure (SSL/TLS).

3. **Internal API Endpoint**: The `/api/accounts?decrypt=true` endpoint should only be accessible from localhost or with proper authentication in production.

4. **Backward Compatibility**: The system will attempt to decrypt existing keys. If decryption fails, it assumes the key is plaintext (for migration purposes).

## Benefits

1. **Security**: API keys are encrypted at rest in the database
2. **Accessibility**: Accounts are accessible from any device connected to your database
3. **Production-Ready**: Uses industry-standard AES-256-GCM encryption
4. **Backward Compatible**: Existing plaintext keys will continue to work until re-encrypted

## Troubleshooting

### Python Engine Can't Access Accounts
- Check that `API_BASE_URL` is set correctly
- Verify the API server is running
- Check that `/api/accounts?decrypt=true` endpoint is accessible from the Python engine's location
- Ensure the request is coming from localhost or includes proper authentication token

### Decryption Errors
- Verify `ENCRYPTION_KEY` is set correctly
- Ensure the same key is used for encryption and decryption
- Check that keys were encrypted with the current encryption key

### Accounts Not Appearing
- Verify database connection
- Check that accounts exist in the database
- Ensure frontend is fetching from `/api/accounts` endpoint
