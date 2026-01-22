import React, { useState, useEffect } from 'react';
import MetricsGrid from './MetricsGrid';
import PortfolioChart from './PortfolioChart';
import { Clock, ShieldCheck } from 'lucide-react';

const PaperTrading: React.FC = () => {
  const [trades, setTrades] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalPnL: 0, winRate: 0, totalTrades: 0 });

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch only PAPER trades
        const tradesRes = await fetch('/api/trades/Paper');
        const statsRes = await fetch('/api/stats/Paper');
        
        if (tradesRes.ok) {
          const tradesData = await tradesRes.json();
          setTrades(Array.isArray(tradesData) ? tradesData : []);
        } else {
          console.error("Failed to fetch paper trades:", tradesRes.status);
          setTrades([]);
        }
        
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        } else {
          console.error("Failed to fetch paper stats:", statsRes.status);
        }
      } catch (error) {
        console.error("Failed to fetch paper data", error);
        setTrades([]);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 5000); // Live refresh
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-white">Paper Trading</h1>
        <p className="text-zinc-500 text-sm">Simulated engine with live performance tracking.</p>
      </div>

      {/* Dynamic Metrics */}
      <MetricsGrid 
        totalPnL={stats.totalPnL} 
        portfolioEquity={100000 + stats.totalPnL} // Assuming 100k starting paper cash
        positionValue={0} 
        availableCash={100000} 
        winRate={Number(stats.winRate)} 
        totalTrades={stats.totalTrades} 
        profitableTrades={0} lossTrades={0}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-3 bg-[#121212] rounded-2xl p-6 border border-zinc-800">
          <PortfolioChart />
        </div>
      </div>

      {/* Live Trade Log */}
      <div className="bg-[#121212] border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center gap-3 bg-[#171717]/50">
          <Clock size={18} className="text-[#86c7f3]" />
          <h2 className="text-base font-bold text-zinc-200 uppercase">Execution Log</h2>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-400">
            <thead className="bg-[#171717] text-xs font-bold uppercase border-b border-zinc-800">
              <tr>
                <th className="px-6 py-4">Time</th>
                <th className="px-6 py-4">Ticker</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Price</th>
                <th className="px-6 py-4">Account</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {trades.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-zinc-600">No paper trades recorded yet.</td></tr>
              ) : (
                trades.map((t: any) => (
                  <tr key={t.id} className="hover:bg-zinc-800/20">
                    <td className="px-6 py-4">{new Date(t.timestamp).toLocaleString()}</td>
                    <td className="px-6 py-4 font-bold text-white">{t.ticker}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${t.action === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        {t.action}
                      </span>
                    </td>
                    <td className="px-6 py-4">${Number(t.price).toFixed(2)}</td>
                    <td className="px-6 py-4 text-xs font-mono">{t.account_name || t.account_id}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PaperTrading;