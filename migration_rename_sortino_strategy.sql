-- Migration: Rename strategy from "Sortino's Model" to "Sortino Model"
-- Run in Neon SQL Editor

UPDATE accounts SET strategy_name = 'Sortino Model' WHERE strategy_name = 'Sortino''s Model';
