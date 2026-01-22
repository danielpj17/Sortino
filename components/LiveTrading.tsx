import React, { useState, useEffect, useRef } from 'react';
import MetricsGrid from './MetricsGrid';
import PortfolioChart from './PortfolioChart';
import { Activity, Clock, ChevronDown } from 'lucide-react';

const LiveTrading: React.FC = () => {
  const [trades, setTrades] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalPnL: 0, winRate: 0, totalTrades: 0 });
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const accountDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch accounts on mount
  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const res = await fetch('/api/accounts');
        if (res.ok) {
          const data = await res.json();
          const liveAccounts = Array.isArray(data) ? data.filter((a: any) => a.type === 'Live') : [];
          setAccounts(liveAccounts);
        }
      } catch (error) {
        console.error("Failed to fetch accounts", error);
      }
    };
    fetchAccounts();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target as Node)) {
        setIsAccountDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Build URL with optional account_id
        const tradesUrl = selectedAccountId 
          ? `/api/trades/Live?account_id=${selectedAccountId}`
          : '/api/trades/Live';
        const statsUrl = selectedAccountId
          ? `/api/stats/Live?account_id=${selectedAccountId}`
          : '/api/stats/Live';
        
        const tradesRes = await fetch(tradesUrl);
        const statsRes = await fetch(statsUrl);
        
        if (tradesRes.ok) {
          const tradesData = await tradesRes.json();
          setTrades(Array.isArray(tradesData) ? tradesData : []);
        } else {
          console.error("Failed to fetch live trades:", tradesRes.status);
          setTrades([]);
        }
        
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        } else {
          console.error("Failed to fetch live stats:", statsRes.status);
        }
      } catch (error) {
        console.error("Failed to fetch live data", error);
        setTrades([]);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [selectedAccountId]);

  const selectedAccount = selectedAccountId ? accounts.find(a => a.id === selectedAccountId) : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-white">Live Execution</h1>
          <p className="text-zinc-500 text-sm">Real-time production engine.</p>
        </div>
        
        {/* Account Dropdown */}
        <div className="relative" ref={accountDropdownRef}>
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1.5 block px-1">Account</label>
          <button 
            onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
            className={`flex items-center gap-3 bg-[#121212] border transition-all px-4 py-2.5 rounded-xl w-[200px] text-left group ${isAccountDropdownOpen ? 'border-[#86c7f3] ring-2 ring-[#86c7f3]/10' : 'border-zinc-800 hover:border-zinc-700'}`}
          >
            <div className="p-1.5 bg-rose-500/10 rounded-lg">
              <Activity size={16} className="text-rose-400" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-zinc-200 text-xs font-bold truncate leading-tight">
                {selectedAccount ? selectedAccount.name : 'All Accounts'}
              </p>
              <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Live Trading</p>
            </div>
            <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-300 ${isAccountDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isAccountDropdownOpen && (
            <div className="absolute top-full right-0 mt-2 w-full bg-[#121212] border border-zinc-800 rounded-xl shadow-2xl z-50 py-2 animate-in slide-in-from-top-2 duration-200 overflow-hidden">
              <button
                onClick={() => { setSelectedAccountId(null); setIsAccountDropdownOpen(false); }}
                className={`w-full px-4 py-3 flex items-center gap-3 transition-colors text-left hover:bg-zinc-800/50 ${!selectedAccountId ? 'bg-zinc-800/30' : ''}`}
              >
                <span className="text-xs font-bold text-zinc-300">All Accounts</span>
              </button>
              {accounts.map((account) => (
                <button
                  key={account.id}
                  onClick={() => { setSelectedAccountId(account.id); setIsAccountDropdownOpen(false); }}
                  className={`w-full px-4 py-3 flex items-center gap-3 transition-colors text-left hover:bg-zinc-800/50 ${selectedAccountId === account.id ? 'bg-zinc-800/30' : ''}`}
                >
                  <span className="text-xs font-bold text-zinc-300">{account.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <MetricsGrid 
        totalPnL={stats.totalPnL} 
        portfolioEquity={0} // Live equity requires Alpaca API calls (Future Step)
        positionValue={0} 
        availableCash={0} 
        winRate={Number(stats.winRate)} 
        totalTrades={stats.totalTrades} 
        profitableTrades={0} lossTrades={0}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-3 bg-[#121212] rounded-2xl p-6 border border-zinc-800">
          <PortfolioChart />
        </div>
      </div>

      <div className="bg-[#121212] border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center gap-3 bg-[#171717]/50">
          <Activity size={18} className="text-rose-400" />
          <h2 className="text-base font-bold text-zinc-200 uppercase">Live Trade Log</h2>
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
                <tr><td colSpan={5} className="px-6 py-8 text-center text-zinc-600">No live trades recorded yet.</td></tr>
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

export default LiveTrading;