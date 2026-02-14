-- SQL Schema for QuantAI Platform (Neon Serverless Postgres)

-- Accounts table: stores Alpaca API credentials and bot settings
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Paper', 'Live')),
    api_key TEXT NOT NULL,
    secret_key TEXT NOT NULL,
    allow_shorting BOOLEAN NOT NULL DEFAULT FALSE,
    max_position_size DECIMAL(5, 4) NOT NULL DEFAULT 0.40,
    bot_name TEXT DEFAULT 'ALPHA-01',
    account_type_display TEXT DEFAULT 'CASH',
    strategy_name TEXT DEFAULT 'Sortino Model',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);

-- Migration: Add bot settings to accounts (run after accounts table exists)
-- max_position_size 0.40 = 40% of equity per position.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS allow_shorting BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS max_position_size DECIMAL(5, 4) NOT NULL DEFAULT 0.40;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bot_name TEXT DEFAULT 'ALPHA-01';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_type_display TEXT DEFAULT 'CASH';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS strategy_name TEXT DEFAULT 'Sortino Model';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ticker TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),
    price DECIMAL(18, 4) NOT NULL,
    quantity INTEGER NOT NULL,
    strategy TEXT NOT NULL,
    pnl DECIMAL(18, 4) DEFAULT 0.00,
    company_name TEXT,
    sell_trade_id INTEGER REFERENCES trades(id),
    account_id TEXT REFERENCES accounts(id),
    experience_id INTEGER
);

-- Ensure account_id and experience_id columns exist (migration for existing tables)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES accounts(id);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS experience_id INTEGER;

-- Index for faster lookups on ticker and date
CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_account_id ON trades(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_experience_id ON trades(experience_id);

-- Training experiences table: stores observations, actions, and rewards for RL training
CREATE TABLE IF NOT EXISTS training_experiences (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ticker TEXT NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    observation JSONB NOT NULL,  -- Store market state (OHLCV window)
    action INTEGER NOT NULL,  -- 0 = HOLD/SELL, 1 = BUY
    reward DECIMAL(18, 6),  -- Calculated reward (NULL if trade not completed)
    trade_id INTEGER REFERENCES trades(id),  -- Link to actual trade if executed
    is_completed BOOLEAN DEFAULT FALSE,  -- True when trade is closed and reward calculated
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for training_experiences
CREATE INDEX idx_training_experiences_ticker ON training_experiences(ticker);
CREATE INDEX idx_training_experiences_timestamp ON training_experiences(timestamp);
CREATE INDEX idx_training_experiences_account_id ON training_experiences(account_id);
CREATE INDEX idx_training_experiences_completed ON training_experiences(is_completed);
CREATE INDEX idx_training_experiences_trade_id ON training_experiences(trade_id);

-- Model versions table: track model performance and enable rollback
CREATE TABLE IF NOT EXISTS model_versions (
    id SERIAL PRIMARY KEY,
    version_number INTEGER NOT NULL,
    model_path TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    training_type TEXT NOT NULL CHECK (training_type IN ('initial', 'online', 'full_retrain')),
    total_experiences INTEGER DEFAULT 0,
    win_rate DECIMAL(5, 2),  -- Percentage of profitable trades
    avg_pnl DECIMAL(18, 4),  -- Average PNL per trade
    sortino_ratio DECIMAL(10, 4),  -- Sortino ratio metric
    total_trades INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT FALSE,  -- Only one active version at a time
    notes TEXT
);

-- Migration: Add strategy column for multi-strategy support (sortino, upside)
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS strategy TEXT DEFAULT 'sortino';
CREATE INDEX IF NOT EXISTS idx_model_versions_strategy ON model_versions(strategy);

-- Indexes for model_versions
CREATE INDEX idx_model_versions_active ON model_versions(is_active);
CREATE INDEX idx_model_versions_created_at ON model_versions(created_at DESC);
CREATE UNIQUE INDEX idx_model_versions_active_unique ON model_versions(is_active) WHERE is_active = TRUE;

-- Bot state table: tracks which accounts have active trading bots (Heartbeat architecture)
-- account_id matches accounts.id type (TEXT)
-- metadata: JSONB for batch_start (ticker rotation) and future extensions
CREATE TABLE IF NOT EXISTS bot_state (
    id SERIAL PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    is_running BOOLEAN DEFAULT FALSE,
    always_on BOOLEAN DEFAULT FALSE,
    last_heartbeat TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    UNIQUE(account_id)
);

-- Migration: Add metadata if table already exists
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_bot_state_running ON bot_state(is_running);
CREATE INDEX IF NOT EXISTS idx_bot_state_always_on ON bot_state(always_on);
CREATE INDEX IF NOT EXISTS idx_bot_state_account_id ON bot_state(account_id);

-- Model predictions table: track prediction history for analysis
CREATE TABLE IF NOT EXISTS model_predictions (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ticker TEXT NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    action_code INTEGER NOT NULL,  -- 0 = SELL, 1 = BUY
    action_type TEXT NOT NULL,  -- 'BUY' or 'SELL'
    price DECIMAL(18, 4) NOT NULL,
    buy_probability DECIMAL(5, 4),  -- Probability of BUY action
    sell_probability DECIMAL(5, 4),  -- Probability of SELL action
    price_change_10d_pct DECIMAL(10, 4),  -- 10-day price change percentage
    volatility_10d DECIMAL(18, 4),  -- 10-day volatility
    data_points INTEGER,  -- Number of data points used
    was_executed BOOLEAN DEFAULT FALSE,  -- Whether trade was actually executed
    trade_id INTEGER REFERENCES trades(id),  -- Link to trade if executed
    skip_reason TEXT  -- Reason if trade was skipped
);

CREATE INDEX IF NOT EXISTS idx_model_predictions_ticker ON model_predictions(ticker);
CREATE INDEX IF NOT EXISTS idx_model_predictions_timestamp ON model_predictions(timestamp);
CREATE INDEX IF NOT EXISTS idx_model_predictions_account_id ON model_predictions(account_id);
CREATE INDEX IF NOT EXISTS idx_model_predictions_action ON model_predictions(action_code);

-- Migration: Add smoothed probability columns for decision layer smoothing
ALTER TABLE model_predictions ADD COLUMN IF NOT EXISTS smoothed_buy_probability DECIMAL(5, 4);
ALTER TABLE model_predictions ADD COLUMN IF NOT EXISTS smoothed_sell_probability DECIMAL(5, 4);
ALTER TABLE model_predictions ADD COLUMN IF NOT EXISTS final_action_code INTEGER;
