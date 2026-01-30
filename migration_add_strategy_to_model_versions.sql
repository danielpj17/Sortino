-- Migration: Add strategy column to model_versions for dual-model support (Sortino + Upside)
-- Run in Neon SQL Editor. Creates model_versions if missing, or adds strategy column if it exists.

-- Create model_versions table if it doesn't exist (includes strategy from the start)
CREATE TABLE IF NOT EXISTS model_versions (
    id SERIAL PRIMARY KEY,
    version_number INTEGER NOT NULL,
    model_path TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    training_type TEXT NOT NULL CHECK (training_type IN ('initial', 'online', 'full_retrain')),
    total_experiences INTEGER DEFAULT 0,
    win_rate DECIMAL(5, 2),
    avg_pnl DECIMAL(18, 4),
    sortino_ratio DECIMAL(10, 4),
    total_trades INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT FALSE,
    notes TEXT,
    strategy TEXT NOT NULL DEFAULT 'sortino'
);

-- Add strategy column if table existed without it
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS strategy TEXT NOT NULL DEFAULT 'sortino';

-- Backfill any NULLs (shouldn't exist with DEFAULT, but safe)
UPDATE model_versions SET strategy = 'sortino' WHERE strategy IS NULL;

-- Drop old unique index (one active model globally)
DROP INDEX IF EXISTS idx_model_versions_active_unique;

-- Create indexes if missing
CREATE INDEX IF NOT EXISTS idx_model_versions_active ON model_versions(is_active);
CREATE INDEX IF NOT EXISTS idx_model_versions_created_at ON model_versions(created_at DESC);

-- Create new partial unique index (one active model per strategy)
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_versions_active_per_strategy
  ON model_versions(strategy) WHERE is_active = TRUE;
