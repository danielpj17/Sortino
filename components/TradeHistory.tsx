
import React, { useState, useRef, useEffect } from 'react';
import { Clock, ChevronDown, ShieldCheck, Activity, Download, Search, Filter } from 'lucide-react';
import { TradeAction } from '../types';

const ALL_ACCOUNTS = [
  { id: 'acc-001', name: 'Standard Strategy (Paper)', type: 'Paper' },
  { id: 'acc-002', name: 'Aggressive Alpha (Paper)', type: 'Paper' },
  { id: 'acc-003', name: 'Long Term Growth (Paper)', type: 'Paper' },
  { id: 'live-001', name: 'Primary Brokerage (Live)', type: 'Live' },
  { id: 'live-002', name: 'Secondary Alpha (Live)', type: 'Live' },
];

const TradeHistory: React.FC = () => {
  const [selectedAccount, setSelectedAccount] = useState(ALL_ACCOUNTS[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fullHistory = Array.from({ length: 15 }).map((_, i) => {
    const buyPrice = 150 + Math.random() * 700;
    const sellPrice = buyPrice + (Math.random() * 40 - 15);
    const qty = Math.floor(Math.random() * 10) + 1;
    const pnl = (sellPrice - buyPrice) * qty;
    return {
      id: `TX-${10000 + i}`,
      ticker: ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMD'][i % 5],
      companyName: ['Apple Inc.', 'Tesla, Inc.', 'Microsoft Corp.', 'NVIDIA Corp.', 'AMD'][i % 5],
      buyTimestamp: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      buyPrice: buyPrice,
      sellTimestamp: new Date(Date.now() - i * 86400000).toISOString(),
      sellPrice: sellPrice,
      quantity: qty,
      pnl: pnl,
      strategy: 'PPO-Alpha-v1'
    };
  });

  const getHoldTime = (start: string, end: string) => {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    const diff = e - s;
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(hrs / 24);
    if (days > 0) return `${days}d ${hrs % 24}h`;
    return `${hrs}h ${Math.floor((diff / 60000) % 60)}m`;
  };

  const formatTimestamp = (ts: string) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-full overflow-x-hidden">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Execution Ledger</h1>
          <p className="text-zinc-500 text-sm font-medium">Historical record of all synchronized trades.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative" ref={dropdownRef}>
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1.5 block px-1">Source Account</label>
            <button 
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={`flex items-center gap-3 bg-[#121212] border transition-all px-4 py-2.5 rounded-xl w-[260px] text-left group ${isDropdownOpen ? 'border-[#86c7f3] ring-2 ring-[#86c7f3]/10' : 'border-zinc-800 hover:border-zinc-700'}`}
            >
              <div className="p-1.5 bg-[#86c7f3]/10 rounded-lg group-hover:scale-110 transition-transform">
                {selectedAccount.type === 'Live' ? <Activity size={16} className="text-[#86c7f3]" /> : <ShieldCheck size={16} className="text-[#86c7f3]" />}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-zinc-200 text-xs font-bold truncate leading-tight">{selectedAccount.name}</p>
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{selectedAccount.type} History</p>
              </div>
              <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isDropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-full bg-[#121212] border border-zinc-800 rounded-xl shadow-2xl z-50 py-2 animate-in slide-in-from-top-2 duration-200 overflow-hidden">
                {ALL_ACCOUNTS.map(acc => (
                  <button
                    key={acc.id}
                    onClick={() => {
                      setSelectedAccount(acc);
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-3 flex items-center gap-3 transition-colors text-left ${selectedAccount.id === acc.id ? 'bg-[#86c7f3]/10' : 'hover:bg-zinc-800/50'}`}
                  >
                    {acc.type === 'Live' ? <Activity size={14} className={selectedAccount.id === acc.id ? 'text-[#86c7f3]' : 'text-zinc-600'} /> : <ShieldCheck size={14} className={selectedAccount.id === acc.id ? 'text-[#86c7f3]' : 'text-zinc-600'} />}
                    <div>
                      <p className={`text-xs font-bold ${selectedAccount.id === acc.id ? 'text-[#86c7f3]' : 'text-zinc-300'}`}>{acc.name}</p>
                      <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">{acc.type} Ledger</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="pt-5"><button className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 px-4 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest text-zinc-200 border border-zinc-700 shadow-sm transition-colors"><Download size={14} />CSV</button></div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} /><input type="text" placeholder="Search ticker or strategy..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-[#121212] border border-zinc-800 rounded-xl py-2.5 pl-11 pr-4 text-sm text-zinc-200 focus:outline-none focus:border-[#86c7f3] transition-all placeholder:text-zinc-600" /></div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-[#121212] border border-zinc-800 rounded-xl text-xs font-bold text-zinc-400 uppercase tracking-widest hover:border-zinc-700">Filter</button>
      </div>

      <div className="bg-[#121212] border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#171717]/50"><div className="flex items-center gap-3"><Clock size={18} className="text-[#86c7f3]" /><h2 className="text-base font-bold text-zinc-200 uppercase tracking-tight">Ledger History</h2></div></div>
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse table-auto min-w-[900px]">
            <thead className="bg-[#171717] text-zinc-500 text-xs font-bold uppercase tracking-widest border-b border-zinc-800">
              <tr><th className="px-6 py-4">Asset</th><th className="px-6 py-4">Entry Event</th><th className="px-6 py-4 text-center">Qty</th><th className="px-6 py-4">Exit Event</th><th className="px-6 py-4">Realized PnL</th><th className="px-6 py-4">Duration</th><th className="px-6 py-4 text-right">Reference ID</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {fullHistory.map((trade) => (
                <tr key={trade.id} className="hover:bg-zinc-800/20 transition-colors group">
                  <td className="px-6 py-5"><div className="flex flex-col"><span className="font-bold text-zinc-100 text-sm">{trade.ticker}</span><span className="text-xs text-zinc-500 font-medium truncate max-w-[120px]">{trade.companyName}</span></div></td>
                  <td className="px-6 py-5"><div className="flex flex-col gap-1"><div className="flex items-center gap-2"><span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded uppercase">Entry</span><span className="text-xs text-zinc-500 font-medium">{formatTimestamp(trade.buyTimestamp)}</span></div><span className="text-sm font-bold text-zinc-200">${trade.buyPrice.toFixed(2)}</span></div></td>
                  <td className="px-6 py-5 text-sm font-semibold text-zinc-300 text-center">{trade.quantity}</td>
                  <td className="px-6 py-5"><div className="flex flex-col gap-1"><div className="flex items-center gap-2"><span className="text-[10px] font-black text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded uppercase">Exit</span><span className="text-xs text-zinc-500 font-medium">{formatTimestamp(trade.sellTimestamp)}</span></div><span className="text-sm font-bold text-zinc-200">${trade.sellPrice.toFixed(2)}</span></div></td>
                  <td className={`px-6 py-5 text-sm font-black ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.pnl > 0 ? '+' : ''}{trade.pnl.toFixed(2)}</td>
                  <td className="px-6 py-5 text-xs text-zinc-400 font-bold uppercase tracking-wider">{getHoldTime(trade.buyTimestamp, trade.sellTimestamp)}</td>
                  <td className="px-6 py-5 text-right"><span className="text-xs font-mono text-zinc-600 font-bold">{trade.id}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TradeHistory;
