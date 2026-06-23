/**
 * Migration 002: 配方收益 + 交易历史价格字段
 */
export const MIGRATION_002 = `
-- 配方表加收益数据
ALTER TABLE recipes ADD COLUMN profit_json TEXT;

-- 交易历史表加价格/收益
ALTER TABLE tradeup_history ADD COLUMN total_cost REAL;
ALTER TABLE tradeup_history ADD COLUMN total_profit REAL;
ALTER TABLE tradeup_history ADD COLUMN roi REAL;
`;
