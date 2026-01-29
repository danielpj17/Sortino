-- Migration: Add metadata column to bot_state for batch rotation
-- Run in Neon Dashboard → SQL Editor
-- Fixes: [loop] Using time-based batch rotation for account X: column "metadata" does not exist

ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'bot_state' AND column_name = 'metadata';
