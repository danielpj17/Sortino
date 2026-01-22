import React, { useState, useEffect, useRef } from 'react';
import { Clock, ChevronDown, ShieldCheck, Activity, Download, Search } from 'lucide-react';

const TradeHistory: React.FC = () => {
  const [trades, setTrades] = useState<any[]>([]);
  const [filteredTrades, setFilteredTrades] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'All' | 'Live' | 'Paper'>('All');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  
  const typeDropdownRef = useRef<HTMLDivElement>(null);
  const accountDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch accounts on mount
  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const res = await fetch('/api/accounts');
        if (res.ok) {
          const data = await res.json();
          setAccounts(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        console.error("Failed to fetch accounts", error);
      }
    };
    fetchAccounts();
  }, []);

  // Get accounts filtered by selected type
  const getFilteredAccounts = () => {
    if (filterType === 'All') {
      return accounts;
    }
    return accounts.filter(a => a.type === filterType);
  };

  // Reset account selection when type changes
  useEffect(() => {
    const filtered = getFilteredAccounts();
    if (selectedAccountId && !filtered.find(a => a.id === selectedAccountId)) {
      setSelectedAccountId(null);
    }
  }, [filterType, accounts, selectedAccountId]);

  // Fetch Real Data
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        let url = '/api/trades';
        if (filterType !== 'All') {
          url = `/api/trades/${filterType}`;
          if (selectedAccountId) {
            url += `?account_id=${selectedAccountId}`;
          }
        } else if (selectedAccountId) {
          url = `/api/trades?account_id=${selectedAccountId}`;
        }
        
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const safeData = Array.isArray(data) ? data : [];
          setTrades(safeData);
        } else {
          console.error("Failed to load history:", res.status);
          setTrades([]);
        }
      } catch (err) {
        console.error("Failed to load history:", err);
        setTrades([]);
      }
    };
    fetchHistory();
  }, [filterType, selectedAccountId]);

  // Filter Logic (Search only - type and account filtering done server-side)
  useEffect(() => {
    // Ensure trades is always an array
    const safeTrades = Array.isArray(trades) ? trades : [];
    let result = safeTrades;

    // Filter by Search
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(t => 
        t.ticker.toLowerCase().includes(lowerQuery) || 
        t.strategy?.toLowerCase().includes(lowerQuery) ||
        t.id.toString().includes(lowerQuery)
      );
    }

    setFilteredTrades(result);
  }, [searchQuery, trades]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(event.target as Node)) {
        setIsTypeDropdownOpen(false);
      }
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target as Node)) {
        setIsAccountDropdownOpen(false);
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
          {/* Account Type Filter Dropdown */}
          <div className="relative" ref={typeDropdownRef}>
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1.5 block px-1">Type</label>
            <button 
              onClick={() => setIsTypeDropdownOpen(!isTypeDropdownOpen)}
              className={`flex items-center gap-3 bg-[#181818] border transition-all px-4 py-2.5 rounded-xl w-[160px] text-left group ${isTypeDropdownOpen ? 'border-[#86c7f3] ring-2 ring-[#86c7f3]/10' : 'border-zinc-800 hover:border-zinc-700'}`}
            >
              <div className="p-1.5 bg-[#86c7f3]/10 rounded-lg">
                {filterType === 'Live' ? <Activity size={16} className="text-[#86c7f3]" /> : <ShieldCheck size={16} className="text-[#86c7f3]" />}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-zinc-200 text-xs font-bold truncate leading-tight">{filterType}</p>
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Account Type</p>
              </div>
              <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-300 ${isTypeDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isTypeDropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-full bg-[#181818] border border-zinc-800 rounded-xl shadow-2xl z-50 py-2 animate-in slide-in-from-top-2 duration-200 overflow-hidden">
                {['All', 'Paper', 'Live'].map((type) => (
                  <button
                    key={type}
                    onClick={() => { setFilterType(type as any); setIsTypeDropdownOpen(false); }}
                    className={`w-full px-4 py-3 flex items-center gap-3 transition-colors text-left hover:bg-zinc-800/50 ${filterType === type ? 'bg-zinc-800/30' : ''}`}
                  >
                    <span className="text-xs font-bold text-zinc-300">{type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Account Filter Dropdown */}
          <div className="relative" ref={accountDropdownRef}>
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1.5 block px-1">Account</label>
            <button 
              onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
              className={`flex items-center gap-3 bg-[#121212] border transition-all px-4 py-2.5 rounded-xl w-[200px] text-left group ${isAccountDropdownOpen ? 'border-[#86c7f3] ring-2 ring-[#86c7f3]/10' : 'border-zinc-800 hover:border-zinc-700'}`}
            >
              <div className="p-1.5 bg-[#86c7f3]/10 rounded-lg">
                <ShieldCheck size={16} className="text-[#86c7f3]" />
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-zinc-200 text-xs font-bold truncate leading-tight">
                  {selectedAccountId ? accounts.find(a => a.id === selectedAccountId)?.name || 'Unknown' : 'All Accounts'}
                </p>
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Select Account</p>
              </div>
              <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-300 ${isAccountDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isAccountDropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-full bg-[#181818] border border-zinc-800 rounded-xl shadow-2xl z-50 py-2 animate-in slide-in-from-top-2 duration-200 overflow-hidden max-h-[300px] overflow-y-auto">
                <button
                  onClick={() => { setSelectedAccountId(null); setIsAccountDropdownOpen(false); }}
                  className={`w-full px-4 py-3 flex items-center gap-3 transition-colors text-left hover:bg-zinc-800/50 ${!selectedAccountId ? 'bg-zinc-800/30' : ''}`}
                >
                  <span className="text-xs font-bold text-zinc-300">All Accounts</span>
                </button>
                {getFilteredAccounts().map((account) => (
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
            className="w-full bg-[#181818] border border-zinc-800 rounded-xl py-2.5 pl-11 pr-4 text-sm text-zinc-200 focus:outline-none focus:border-[#86c7f3] transition-all placeholder:text-zinc-600" 
          />
        </div>
      </div>

      <div className="bg-[#181818] border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
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