
export enum TradeAction {
  BUY = 'BUY',
  SELL = 'SELL'
}

export interface Trade {
  id: number;
  timestamp: string;
  ticker: string;
  action: TradeAction;
  price: number;
  quantity: number;
  strategy: string;
  pnl: number;
}

export interface PortfolioPoint {
  time: string;
  value: number;
}

export interface Metrics {
  totalPnL: number;
  winRate: number;
  totalTrades: number;
}

export type AccountType = 'Paper' | 'Live';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  apiKey: string;
  status: 'Connected' | 'Error' | 'Inactive';
  createdAt: string;
}
