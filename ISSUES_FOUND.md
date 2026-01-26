# Issues Found in Codebase

## Critical Issues

### 1. Settings Component Never Loads from Database
**Location:** `components/Settings.tsx` (lines 22-30)

**Problem:**
- Settings component only initializes from localStorage
- Never fetches accounts from `/api/accounts` on mount
- If accounts are added/deleted via API or other components, Settings won't reflect changes

**Impact:** Settings page shows stale data, not the source of truth (database)

**Fix Needed:**
- Add `useEffect` to load accounts from `/api/accounts` on mount
- Sync database accounts with localStorage
- Transform database response (`api_key` → `apiKey` for display)

---

### 2. Account Interface Mismatch (apiKey vs api_key)
**Location:** 
- `types.ts` line 35: `apiKey: string`
- `components/Settings.tsx` line 326: `acc.apiKey`
- `api/accounts.js` line 26: Returns `id, name, type` (no `api_key` for security)

**Problem:**
- TypeScript `Account` interface expects `apiKey` (camelCase)
- Database stores `api_key` (snake_case)
- API GET endpoint doesn't return `api_key` for security reasons
- Settings tries to display `acc.apiKey` which doesn't exist in database responses

**Impact:** 
- Settings can't display API keys from database accounts
- Type mismatch between frontend types and database schema

**Fix Needed:**
- Update `Account` interface to match database response structure
- Or transform database responses to match interface
- Handle masked API key display properly

---

### 3. Inconsistent Account Loading Strategies
**Location:**
- `components/PaperTrading.tsx` (lines 45-80): Database first, localStorage fallback
- `components/LiveTrading.tsx` (lines 45-66): localStorage first, database fallback
- `components/Settings.tsx`: localStorage only

**Problem:**
- Each component uses a different strategy for loading accounts
- No single source of truth pattern

**Impact:** 
- Data can be out of sync between components
- Inconsistent behavior across the app

**Fix Needed:**
- Standardize on database-first approach
- Use localStorage only as cache/fallback
- Consider using a shared state management solution

---

### 4. Settings Doesn't Sync with Database on Mount
**Location:** `components/Settings.tsx`

**Problem:**
- No `useEffect` hook to fetch accounts from database when component mounts
- Only syncs when user manually adds/deletes accounts

**Impact:** 
- Settings page may show outdated account list
- If accounts are managed elsewhere, Settings won't know about them

**Fix Needed:**
- Add `useEffect` to load accounts from `/api/accounts` on mount
- Transform database response to match `Account` interface
- Update localStorage after successful database fetch

---

### 5. Missing `createdAt` in Database Response
**Location:**
- `components/Settings.tsx` line 90: Creates `createdAt` manually
- `api/accounts.js` line 26: SELECT doesn't include `createdAt`

**Problem:**
- `Account` interface expects `createdAt: string`
- Database query doesn't return `createdAt` field
- Settings creates it manually with current date, which may not match actual creation time

**Impact:**
- Incorrect creation dates displayed
- Type mismatch if database has `created_at` column

**Fix Needed:**
- Add `created_at` to SELECT query in `api/accounts.js`
- Or remove `createdAt` requirement from `Account` interface if not needed

---

## Medium Priority Issues

### 6. Account Type Field Inconsistency
**Location:** Multiple files use `type === 'Live'` or `type === 'Paper'`

**Problem:**
- Code assumes `type` can be 'Paper' or 'Live'
- `schema.sql` doesn't show the accounts table definition
- No CHECK constraint visible to enforce valid values

**Impact:**
- Potential for invalid type values in database
- Type mismatches if database uses different values

**Fix Needed:**
- Verify accounts table schema
- Add CHECK constraint if needed: `CHECK (type IN ('Paper', 'Live'))`
- Or document the expected values

---

### 7. Schema.sql Missing Accounts Table Definition
**Location:** `schema.sql`

**Problem:**
- File only contains ALTER TABLE statements
- No CREATE TABLE statement for accounts table
- Can't verify the full structure

**Impact:**
- Unclear what columns exist in accounts table
- Hard to understand data model

**Fix Needed:**
- Add CREATE TABLE statement for accounts table
- Document all columns and constraints

---

## Summary of Variables/Connections That Don't Make Sense

1. **`acc.apiKey` in Settings.tsx line 326** - This property doesn't exist in database responses
2. **Account interface `apiKey`** - Database uses `api_key`, API doesn't return it for security
3. **Settings localStorage-only initialization** - Should load from database first
4. **Inconsistent loading order** - PaperTrading vs LiveTrading use opposite strategies
5. **Missing `createdAt` in API response** - Interface expects it but API doesn't provide it
6. **Account type values** - Not verified against database schema constraints

---

## Recommended Fix Priority

1. **HIGH:** Fix Settings to load from database on mount
2. **HIGH:** Fix Account interface mismatch (apiKey vs api_key)
3. **MEDIUM:** Standardize account loading strategy across components
4. **MEDIUM:** Add `createdAt` to API response or remove from interface
5. **LOW:** Document accounts table schema
6. **LOW:** Add type constraints to database schema
