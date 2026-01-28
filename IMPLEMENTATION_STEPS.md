# Implementation Steps: Decision Layer Smoothing & Opportunity Cost Reward

## Quick Start Checklist

### ✅ Step 1: Database Migration (REQUIRED)

**Option A: Use the migration script (Recommended)**
1. Open `migration_add_smoothing_columns.sql` in your editor
2. Copy the entire contents
3. Paste into Neon Dashboard → SQL Editor
4. Click "Run" or press F5

**Option B: Run manually**
If the `model_predictions` table doesn't exist, run this first:

```sql
-- Create the table first
CREATE TABLE IF NOT EXISTS model_predictions (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ticker TEXT NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    action_code INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    price DECIMAL(18, 4) NOT NULL,
    buy_probability DECIMAL(5, 4),
    sell_probability DECIMAL(5, 4),
    price_change_10d_pct DECIMAL(10, 4),
    volatility_10d DECIMAL(18, 4),
    data_points INTEGER,
    was_executed BOOLEAN DEFAULT FALSE,
    trade_id INTEGER REFERENCES trades(id),
    skip_reason TEXT
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_model_predictions_ticker ON model_predictions(ticker);
CREATE INDEX IF NOT EXISTS idx_model_predictions_timestamp ON model_predictions(timestamp);
CREATE INDEX IF NOT EXISTS idx_model_predictions_account_id ON model_predictions(account_id);
CREATE INDEX IF NOT EXISTS idx_model_predictions_action ON model_predictions(action_code);

-- Then add the new columns
ALTER TABLE model_predictions ADD COLUMN IF NOT EXISTS smoothed_buy_probability DECIMAL(5, 4);
ALTER TABLE model_predictions ADD COLUMN IF NOT EXISTS smoothed_sell_probability DECIMAL(5, 4);
ALTER TABLE model_predictions ADD COLUMN IF NOT EXISTS final_action_code INTEGER;
```

**Or** run the entire `schema.sql` file (it includes `IF NOT EXISTS` checks, so it's safe to run multiple times).

### ✅ Step 2: Restart Services

**If running locally:**
```bash
# Stop current services (Ctrl+C)
# Then restart:
npm run dev
```

**If running Python Model API separately:**
```bash
# Stop the API (Ctrl+C)
# Then restart:
cd python_engine
python model_api.py
```

### ✅ Step 3: Verify Changes

1. **Check Database Schema:**
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'model_predictions' 
   AND column_name IN ('smoothed_buy_probability', 'smoothed_sell_probability', 'final_action_code');
   ```
   Should return 3 rows.

2. **Monitor Trading Loop:**
   - Watch console logs for smoothing decisions
   - Check `model_predictions` table for new entries with smoothed values
   - Verify HOLD actions when probabilities are in dead zone (0.35-0.65)

3. **Test Decision Smoothing:**
   - The system will now maintain rolling averages over last 10 predictions
   - BUY only executes if smoothed buy_prob > 0.65
   - SELL only executes if smoothed sell_prob > 0.65 AND holding position
   - HOLD when probabilities are in dead zone

### ✅ Step 4: Retrain Model (Optional but Recommended)

The opportunity cost penalty (`-0.001` for staying flat) will only affect newly trained models:

```bash
cd python_engine
python train.py
```

Or wait for scheduled retrain (if using `retrain.py`).

## What Changed?

### Decision Layer Smoothing
- **Rolling Window**: Last 10 predictions averaged per ticker
- **Hysteresis**: BUY threshold 0.65, SELL threshold 0.65 (with position)
- **Dead Zone**: 0.35-0.65 = HOLD (maintains current position)
- **Buy Bias**: When probabilities within 5%, favor BUY

### Opportunity Cost Reward
- **Penalty**: `-0.001` when agent stays flat/in cash (`raw_reward === 0.0`)
- **Purpose**: Incentivize active trading over staying in cash
- **Safety**: Downside penalty (`DOWNSIDE_PENALTY_FACTOR = 2.0`) unchanged

## Troubleshooting

### Database Migration Fails
- Check if `model_predictions` table exists
- Verify you have ALTER TABLE permissions
- Run `CREATE TABLE IF NOT EXISTS model_predictions...` first if table doesn't exist

### Smoothing Not Working
- Check console logs for errors
- Verify `rollingWindows` Map is being populated
- Check that `buy_probability` and `sell_probability` are returned from Model API

### Opportunity Cost Not Applied
- Only affects newly trained models
- Retrain model to see effect: `python python_engine/train.py`
- Check `_sortino_reward()` function in `model_manager.py` is updated

## Files Modified

1. `api/trading/loop.js` - Decision smoothing logic
2. `python_engine/train.py` - Opportunity cost reward
3. `python_engine/model_manager.py` - Opportunity cost reward
4. `python_engine/retrain.py` - Uses updated reward from model_manager
5. `schema.sql` - Database migration

## Next Steps

1. ✅ Run database migration
2. ✅ Restart services
3. ✅ Monitor trading behavior
4. ⏳ Retrain model (optional, for opportunity cost to take effect)
5. ⏳ Tune thresholds if needed (CONFIDENCE_THRESHOLD, DEAD_ZONE_LOW/HIGH)
