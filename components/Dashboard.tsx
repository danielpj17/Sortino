import React, { useEffect, useState } from 'react';
import MetricsGrid from './MetricsGrid';
import PortfolioChart from './PortfolioChart';
import RecentTrades from './RecentTrades';
import { Trade } from '../types';

const Dashboard: React.FC = () => {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState({ totalPnL: 0, winRate: 0, totalTrades: 0 });
  const [error, setError] = useState<string | null>(null);

  // Fetch Data from our Bridge Server
  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. Get Trades
        const tradesRes = await fetch('/api/trades');
        if (tradesRes.ok) {
          const tradesData = await tradesRes.json();
          // Ensure it's an array
          setTrades(Array.isArray(tradesData) ? tradesData : []);
        } else {
          console.error("Failed to fetch trades:", tradesRes.status);
          setTrades([]);
        }

        // 2. Get Stats
        const statsRes = await fetch('/api/stats');
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        } else {
          console.error("Failed to fetch stats:", statsRes.status);
          // Keep default stats
        }
        
        setError(null);
      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
        setError("Unable to load data. Please check your database connection.");
        setTrades([]);
      }
    };

    fetchData();
    // Refresh every 5 seconds for "Live" feel
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-full overflow-x-hidden">
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/50 rounded-xl p-4 text-rose-400 text-sm">
          {error}
        </div>
      )}
      
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className="text-zinc-500 text-sm font-medium">Real-time performance metrics (Live Connection).</p>
        </div>
      </div>

      <MetricsGrid 
        totalPnL={stats.totalPnL}
        // These can be calculated or fetched later, sticking to stats for now
        portfolioEquity={10000 + stats.totalPnL} 
        positionValue={0}
        availableCash={10000} 
        winRate={stats.winRate}
        totalTrades={stats.totalTrades}
        profitableTrades={0} // You can add a query for this too!
        lossTrades={0}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#121212] rounded-2xl p-6 border border-zinc-800 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-200 mb-4">Portfolio Performance</h2>
          <PortfolioChart />
        </div>

        <div className="bg-[#121212] rounded-2xl p-6 border border-zinc-800 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-200 mb-6">Recent Activity</h2>
          {/* Pass the real DB trades here */}
          <RecentTrades trades={trades} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;