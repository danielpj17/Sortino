-- Migration Script: Create model_predictions table and add smoothing columns
-- Run this in Neon Dashboard → SQL Editor

-- Step 1: Create the model_predictions table if it doesn't exist
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

-- Step 2: Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_model_predictions_ticker ON model_predictions(ticker);
CREATE INDEX IF NOT EXISTS idx_model_predictions_timestamp ON model_predictions(timestamp);
CREATE INDEX IF NOT EXISTS idx_model_predictions_account_id ON model_predictions(account_id);
CREATE INDEX IF NOT EXISTS idx_model_predictions_action ON model_predictions(action_code);

-- Step 3: Add smoothed probability columns for decision layer smoothing
ALTER TABLE model_predictions ADD COLUMN IF NOT EXISTS smoothed_buy_probability DECIMAL(5, 4);
ALTER TABLE model_predictions ADD COLUMN IF NOT EXISTS smoothed_sell_probability DECIMAL(5, 4);
ALTER TABLE model_predictions ADD COLUMN IF NOT EXISTS final_action_code INTEGER;

-- Verify the migration
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'model_predictions' 
ORDER BY ordinal_position;
