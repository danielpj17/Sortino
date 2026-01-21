
import React from 'react';
import MetricsGrid from './MetricsGrid';
import PortfolioChart from './PortfolioChart';
import RecentTrades from './RecentTrades';
import { Trade, TradeAction } from '../types';

const MOCK_TRADES: Trade[] = [
  { id: 1, timestamp: '2024-03-10T14:30:00Z', ticker: 'AAPL', action: TradeAction.BUY, price: 172.45, quantity: 1, strategy: 'PPO-Alpha', pnl: 0 },
  { id: 2, timestamp: '2024-03-11T09:15:00Z', ticker: 'AAPL', action: TradeAction.SELL, price: 175.20, quantity: 1, strategy: 'PPO-Alpha', pnl: 2.75 },
  { id: 3, timestamp: '2024-03-12T10:45:00Z', ticker: 'TSLA', action: TradeAction.BUY, price: 180.10, quantity: 2, strategy: 'PPO-Alpha', pnl: 0 },
  { id: 4, timestamp: '2024-03-14T11:00:00Z', ticker: 'TSLA', action: TradeAction.SELL, price: 178.50, quantity: 2, strategy: 'PPO-Alpha', pnl: -3.20 },
  { id: 5, timestamp: '2024-03-15T16:00:00Z', ticker: 'NVDA', action: TradeAction.BUY, price: 850.12, quantity: 1, strategy: 'PPO-Alpha', pnl: 0 },
];

const Dashboard: React.FC = () => {
  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-full overflow-x-hidden">
      {/* Unified Header Layout */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className="text-zinc-500 text-sm font-medium">Real-time performance metrics for your AI agent.</p>
        </div>
        
        {/* Placeholder to match height of account selector on other pages */}
        <div className="h-[68px] hidden md:block pointer-events-none opacity-0" aria-hidden="true">
          <label className="text-[10px] mb-1.5 block">Spacer</label>
          <div className="w-[240px] h-[46px] rounded-xl" />
        </div>
      </div>

      <MetricsGrid 
        totalPnL={1245.80}
        portfolioEquity={15420.50}
        positionValue={8240.00}
        availableCash={7180.50}
        winRate={68.5}
        totalTrades={142}
        profitableTrades={97}
        lossTrades={45}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#121212] rounded-2xl p-6 border border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-zinc-200">Portfolio Performance</h2>
          </div>
          <PortfolioChart />
        </div>

        <div className="bg-[#121212] rounded-2xl p-6 border border-zinc-800 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-200 mb-6">Recent Activity</h2>
          <RecentTrades trades={MOCK_TRADES} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
