
import React from 'react';
import { Trade, TradeAction } from '../types';

interface Props {
  trades: Trade[];
}

const RecentTrades: React.FC<Props> = ({ trades }) => {
  // Ensure trades is always an array
  const safeTrades = Array.isArray(trades) ? trades : [];

  if (safeTrades.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-center py-8 text-zinc-500 text-sm">
          No trades found
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {safeTrades.map((trade) => (
        <div key={trade.id} className="flex items-center justify-between p-3.5 bg-zinc-900/30 rounded-xl border border-zinc-800/50 hover:border-zinc-700/80 transition-all hover:bg-zinc-800/40">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-[10px] tracking-widest ${
              trade.action === TradeAction.BUY ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
            }`}>
              {trade.action}
            </div>
            <div>
              <p className="font-bold text-sm text-zinc-100 leading-tight">{trade.ticker}</p>
              <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">{new Date(trade.timestamp).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-sm text-zinc-100">${Number(trade.price).toFixed(2)}</p>
            {/* PnL signs remain green/red as requested */}
            <p className={`text-[10px] font-bold tracking-widest ${Number(trade.pnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {Number(trade.pnl) === 0 ? '--' : `${Number(trade.pnl) > 0 ? '+' : ''}${Number(trade.pnl).toFixed(2)}`}
            </p>
          </div>
        </div>
      ))}
      <button className="w-full py-3 text-zinc-500 text-[11px] font-bold uppercase tracking-widest hover:text-zinc-200 transition-colors border-t border-zinc-800/50 mt-4">
        View all history
      </button>
    </div>
  );
};

export default RecentTrades;
