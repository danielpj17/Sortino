import React, { useState, useEffect, useRef } from 'react';
import { Clock, ChevronDown, ShieldCheck, Activity, Download, Search } from 'lucide-react';

const TradeHistory: React.FC = () => {
  const [trades, setTrades] = useState<any[]>([]);
  const [filteredTrades, setFilteredTrades] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'All' | 'Live' | 'Paper'>('All');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch Real Data
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch('/api/trades'); // Get ALL trades
        if (res.ok) {
          const data = await res.json();
          const safeData = Array.isArray(data) ? data : [];
          setTrades(safeData);
          setFilteredTrades(safeData);
        } else {
          console.error("Failed to load history:", res.status);
          setTrades([]);
          setFilteredTrades([]);
        }
      } catch (err) {
        console.error("Failed to load history:", err);
        setTrades([]);
        setFilteredTrades([]);
      }
    };
    fetchHistory();
  }, []);

  // Filter Logic (Search + Account Type)
  useEffect(() => {
    // Ensure trades is always an array
    const safeTrades = Array.isArray(trades) ? trades : [];
    let result = safeTrades;

    // 1. Filter by Type
    if (filterType !== 'All') {
      // We check the account_id prefix (assuming 'live-' or 'acc-'/paper) 
      // OR you can update the server to return account type. 
      // For now, let's filter by the 'account_name' if available or ID convention.
      result = result.filter(t => 
        filterType === 'Live' 
          ? (t.account_id && t.account_id.startsWith('live')) 
          : (t.account_id && !t.account_id.startsWith('live'))
      );
    }

    // 2. Filter by Search
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(t => 
        t.ticker.toLowerCase().includes(lowerQuery) || 
        t.strategy?.toLowerCase().includes(lowerQuery) ||
        t.id.toString().includes(lowerQuery)
      );
    }

    setFilteredTrades(result);
  }, [searchQuery, filterType, trades]);

  // Dropdown closer
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatTimestamp = (ts: string) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-full overflow-x-hidden">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Execution Ledger</h1>
          <p className="text-zinc-500 text-sm font-medium">Historical record of all synchronized trades.</p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Account Filter Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1.5 block px-1">Filter View</label>
            <button 
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={`flex items-center gap-3 bg-[#121212] border transition-all px-4 py-2.5 rounded-xl w-[200px] text-left group ${isDropdownOpen ? 'border-[#86c7f3] ring-2 ring-[#86c7f3]/10' : 'border-zinc-800 hover:border-zinc-700'}`}
            >
              <div className="p-1.5 bg-[#86c7f3]/10 rounded-lg">
                {filterType === 'Live' ? <Activity size={16} className="text-[#86c7f3]" /> : <ShieldCheck size={16} className="text-[#86c7f3]" />}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-zinc-200 text-xs font-bold truncate leading-tight">{filterType} Trades</p>
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Global Ledger</p>
              </div>
              <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isDropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-full bg-[#121212] border border-zinc-800 rounded-xl shadow-2xl z-50 py-2 animate-in slide-in-from-top-2 duration-200 overflow-hidden">
                {['All', 'Paper', 'Live'].map((type) => (
                  <button
                    key={type}
                    onClick={() => { setFilterType(type as any); setIsDropdownOpen(false); }}
                    className={`w-full px-4 py-3 flex items-center gap-3 transition-colors text-left hover:bg-zinc-800/50`}
                  >
                    <span className="text-xs font-bold text-zinc-300">{type} Trades</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          
          <div className="pt-5">
            <button className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 px-4 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest text-zinc-200 border border-zinc-700 shadow-sm transition-colors">
              <Download size={14} />CSV
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
          <input 
            type="text" 
            placeholder="Search ticker, ID, or strategy..." 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            className="w-full bg-[#121212] border border-zinc-800 rounded-xl py-2.5 pl-11 pr-4 text-sm text-zinc-200 focus:outline-none focus:border-[#86c7f3] transition-all placeholder:text-zinc-600" 
          />
        </div>
      </div>

      <div className="bg-[#121212] border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#171717]/50">
          <div className="flex items-center gap-3">
            <Clock size={18} className="text-[#86c7f3]" />
            <h2 className="text-base font-bold text-zinc-200 uppercase tracking-tight">Ledger History</h2>
          </div>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse table-auto min-w-[900px]">
            <thead className="bg-[#171717] text-zinc-500 text-xs font-bold uppercase tracking-widest border-b border-zinc-800">
              <tr>
                <th className="px-6 py-4">Asset</th>
                <th className="px-6 py-4">Event Time</th>
                <th className="px-6 py-4 text-center">Action</th>
                <th className="px-6 py-4">Price</th>
                <th className="px-6 py-4 text-center">Qty</th>
                <th className="px-6 py-4">Realized PnL</th>
                <th className="px-6 py-4 text-right">Reference ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {filteredTrades.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-zinc-500 text-sm">No trades found matching your criteria.</td></tr>
              ) : (
                filteredTrades.map((trade) => (
                  <tr key={trade.id} className="hover:bg-zinc-800/20 transition-colors group">
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="font-bold text-zinc-100 text-sm">{trade.ticker}</span>
                        <span className="text-xs text-zinc-500 font-medium truncate max-w-[120px]">{trade.strategy || 'Manual'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-xs text-zinc-400 font-bold">{formatTimestamp(trade.timestamp)}</span>
                    </td>
                    <td className="px-6 py-5 text-center">
                       <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${trade.action === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        {trade.action}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-sm font-bold text-zinc-200">${Number(trade.price).toFixed(2)}</td>
                    <td className="px-6 py-5 text-sm font-semibold text-zinc-300 text-center">{trade.quantity}</td>
                    <td className={`px-6 py-5 text-sm font-black ${Number(trade.pnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {Number(trade.pnl) > 0 ? '+' : ''}{Number(trade.pnl).toFixed(2)}
                    </td>
                    <td className="px-6 py-5 text-right">
                      <div className="flex flex-col items-end">
                        <span className="text-xs font-mono text-zinc-600 font-bold">#{trade.id}</span>
                        <span className="text-[9px] text-zinc-700 uppercase">{trade.account_id}</span>
                      </div>
                    </td>
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

export default TradeHistory;