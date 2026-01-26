# Model Prediction Analysis

## Issue: Model Always Predicting SELL

### Current Behavior
- All 11 tickers in the batch returned `action: "SELL"` (action_code = 0)
- All trades were skipped with `reason: "shorting_disabled"`
- No existing positions to close

### Root Cause Analysis

#### 1. Model Training Characteristics
- **Training Data**: Historical data from 2015-2024
- **Reward Function**: Sortino-style penalty (heavily penalizes losses)
  - `DOWNSIDE_PENALTY_FACTOR = 2.0`
  - `DOWNSIDE_SQUARED = True` (squares negative returns)
  - This makes the model extremely risk-averse

#### 2. Model Architecture
- **Algorithm**: PPO (Proximal Policy Optimization)
- **Action Space**: Binary (0 = SELL/HOLD, 1 = BUY)
- **Deterministic Mode**: `deterministic=True` means it always picks the highest probability action
- **Observation Window**: 10 days of OHLCV data

#### 3. Why Model Might Predict SELL

**Hypothesis A: Overly Conservative Training**
- The Sortino penalty (2x squared on losses) makes the model extremely risk-averse
- The model may have learned that "not trading" (SELL/HOLD) is safer than BUY
- Historical training data might have shown more losses than gains during certain periods

**Hypothesis B: Market Conditions**
- Current market conditions might genuinely favor SELL signals
- The model might be correctly identifying overvalued conditions
- Recent price movements might indicate bearish trends

**Hypothesis C: Model Bias**
- The model might have a bias toward action 0 (SELL) due to:
  - Training data imbalance
  - Reward function design
  - Insufficient training iterations (5000 timesteps per ticker)

**Hypothesis D: Observation Space Issues**
- The 10-day window might not capture enough signal
- Missing features (e.g., volume patterns, technical indicators)
- Data quality issues in recent market data

### Investigation Steps

1. **Check Action Probabilities**
   - Added logging to capture `buy_probability` and `sell_probability`
   - If probabilities are close (e.g., 51% SELL, 49% BUY), the model is uncertain
   - If probabilities are extreme (e.g., 95% SELL, 5% BUY), the model is confident

2. **Analyze Market Context**
   - Check recent price changes (10-day % change)
   - Check volatility metrics
   - Compare current conditions to training data period

3. **Review Training Process**
   - Model trains on 2015-2024 data (9 years)
   - Only 5000 timesteps per ticker (might be insufficient)
   - Sequential training (one ticker at a time) might cause bias

4. **Test Model Behavior**
   - Run predictions on different market conditions
   - Test with different tickers
   - Compare predictions over multiple time periods

### Recommendations

#### Short Term
1. **Enable Shorting** (if you want to allow short positions)
   - This will allow SELL predictions to execute
   - Configure Agent → Select MARGIN → Enable Short Selling

2. **Monitor Prediction Patterns**
   - Use the new logging to track:
     - Action probabilities
     - Price changes
     - Volatility metrics
   - Look for patterns over multiple health-check cycles

#### Medium Term
1. **Retrain Model with Different Parameters**
   - Reduce `DOWNSIDE_PENALTY_FACTOR` (e.g., 1.5 instead of 2.0)
   - Increase training timesteps (e.g., 10000 per ticker)
   - Add more training data (extend to 2025)

2. **Improve Observation Space**
   - Add technical indicators (RSI, MACD, moving averages)
   - Increase window size (e.g., 20 days instead of 10)
   - Add volume-based features

3. **Adjust Reward Function**
   - Balance risk/reward more evenly
   - Consider Sharpe ratio instead of pure Sortino
   - Add transaction cost penalties

#### Long Term
1. **Implement Online Learning**
   - Retrain model with live trading experiences
   - Update model based on actual P&L
   - Use the `training_experiences` table for continuous learning

2. **A/B Testing**
   - Run multiple model versions in parallel
   - Compare performance metrics
   - Rollback to better-performing versions

### Next Steps

1. Deploy the enhanced logging
2. Run health-check multiple times to collect prediction data
3. Analyze the action probabilities and market context
4. Determine if predictions are correct or if model needs retraining
