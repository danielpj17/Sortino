
import React from 'react';
import { DollarSign, Target, Briefcase, TrendingUp, TrendingDown, Wallet, Landmark } from 'lucide-react';

interface MetricsProps {
  totalPnL: number;
  portfolioEquity: number;
  positionValue: number;
  availableCash: number;
  winRate: number;
  totalTrades: number;
  profitableTrades: number;
  lossTrades: number;
  percentChange?: number;
}

const MetricsGrid: React.FC<MetricsProps> = ({ 
  totalPnL, 
  portfolioEquity, 
  positionValue, 
  availableCash, 
  winRate, 
  totalTrades,
  profitableTrades,
  lossTrades,
  percentChange
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard 
        title="Portfolio Equity" 
        value={`$${portfolioEquity.toLocaleString()}`} 
        subValue={
          <span className={totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            {totalPnL >= 0 ? '+' : '-'}${Math.abs(totalPnL).toLocaleString()}
          </span>
        }
        icon={<Wallet size={18} />} 
        color="sky"
        trend={percentChange !== undefined ? percentChange : undefined}
      />
      <MetricCard 
        title="Position / Cash" 
        value={`$${positionValue.toLocaleString()}`} 
        subValue={`Cash: $${availableCash.toLocaleString()}`}
        icon={<Landmark size={18} />} 
        color="sky"
      />
      <MetricCard 
        title="Total Trades" 
        value={totalTrades.toString()} 
        subValue={`${profitableTrades} Wins / ${lossTrades} Losses`}
        icon={<Briefcase size={18} />} 
        color="sky"
      />
      <MetricCard 
        title="Win Rate" 
        value={`${winRate}%`} 
        icon={<Target size={18} />} 
        color="sky"
      />
    </div>
  );
};

interface MetricCardProps {
  title: string;
  value: string;
  subValue?: React.ReactNode;
  icon: React.ReactNode;
  color: 'sky' | 'zinc' | 'red';
  trend?: number;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, subValue, icon, color, trend }) => {
  const colorMap = {
    sky: 'bg-[#86c7f3]/10 text-[#86c7f3] border-[#86c7f3]/20',
    zinc: 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50',
    red: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  };

  return (
    <div className="bg-[#181818] border border-zinc-800/80 p-5 rounded-xl shadow-sm relative overflow-hidden group hover:border-zinc-700 transition-colors">
      <div className="flex justify-between items-start mb-3">
        <div className={`p-2 rounded-lg ${colorMap[color]}`}>
          {icon}
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full ${trend >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
            {trend >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div>
        <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-1">{title}</p>
        <p className="text-xl font-bold tracking-tight text-white leading-none">{value}</p>
        {subValue && (
          <div className="text-[10px] font-bold text-zinc-500 mt-2 uppercase tracking-wide">
            {subValue}
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricsGrid;
