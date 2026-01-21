
-- SQL Schema for QuantAI Platform (Neon Serverless Postgres)

CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ticker TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),
    price DECIMAL(18, 4) NOT NULL,
    quantity INTEGER NOT NULL,
    strategy TEXT NOT NULL,
    pnl DECIMAL(18, 4) DEFAULT 0.00
);

-- Index for faster lookups on ticker and date
CREATE INDEX idx_trades_ticker ON trades(ticker);
CREATE INDEX idx_trades_timestamp ON trades(timestamp);
