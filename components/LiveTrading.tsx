
import React, { useState, useRef, useEffect } from 'react';
import MetricsGrid from './MetricsGrid';
import PortfolioChart from './PortfolioChart';
import { Signal, X, Clock, ChevronDown, Settings, Activity, Search } from 'lucide-react';
import { TradeAction } from '../types';

interface ExtendedTrade {
  id: string;
  ticker: string;
  companyName: string;
  buyTimestamp: string;
  buyPrice: number;
  sellTimestamp?: string;
  sellPrice?: number;
  currentPrice: number;
  quantity: number;
  pnl: number;
}

const LIVE_ACCOUNTS = [
  { id: 'live-001', name: 'Primary Brokerage (Alpaca)', type: 'Live' },
  { id: 'live-002', name: 'Secondary Alpha (Interactive)', type: 'Live' },
];

const BOTS = ['PPO-Production-V2', 'Sortino-Sage-V1', 'Zeta-Core-Live'];
const ACCOUNT_TYPES = ['Cash', 'Margin'];

const LiveTrading: React.FC = () => {
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [historyTab, setHistoryTab] = useState<'positions' | 'completed'>('positions');
  
  const [selectedAccount, setSelectedAccount] = useState(LIVE_ACCOUNTS[0]);
  const [selectedBot, setSelectedBot] = useState(BOTS[0]);
  const [accountType, setAccountType] = useState(ACCOUNT_TYPES[1]);

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

  const logs = [
    "System check: All systems nominal.",
    "Authentication successful with Alpaca API.",
    "Real-time stream connected to Polygon.io",
    "Loading production model 'ppo_v2_stable'...",
    "Scanning watchlists for high-confidence entries...",
    "Order execution engine ready.",
    "Holding: No active signal on AAPL/TSLA."
  ];

  const openPositions: ExtendedTrade[] = [
    { id: "TX-LIVE-101", ticker: 'MSFT', companyName: 'Microsoft Corp.', buyTimestamp: new Date(Date.now() - 12000000).toISOString(), buyPrice: 412.10, currentPrice: 425.40, quantity: 20, pnl: 266.00 },
    { id: "TX-LIVE-102", ticker: 'AMD', companyName: 'Advanced Micro Devices', buyTimestamp: new Date(Date.now() - 7200000).toISOString(), buyPrice: 185.10, currentPrice: 192.10, quantity: 50, pnl: 350.00 },
  ];

  const completedTrades: ExtendedTrade[] = [
    { id: "TX-LIVE-99", ticker: 'GOOGL', companyName: 'Alphabet Inc.', buyTimestamp: new Date(Date.now() - 86400000).toISOString(), buyPrice: 142.20, sellTimestamp: new Date(Date.now() - 82800000).toISOString(), sellPrice: 145.30, currentPrice: 145.30, quantity: 100, pnl: 310.00 },
  ];

  const formatTimestamp = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-full overflow-x-hidden">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Live Execution</h1>
          <p className="text-zinc-500 text-sm font-medium">Real-time production engine with direct market access.</p>
        </div>
        
        <div className="relative" ref={dropdownRef}>
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1.5 block px-1">Trading Account</label>
          <button 
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className={`flex items-center gap-3 bg-[#121212] border transition-all px-4 py-2.5 rounded-xl w-[240px] text-left group ${isDropdownOpen ? 'border-[#86c7f3] ring-2 ring-[#86c7f3]/10' : 'border-zinc-800 hover:border-zinc-700'}`}
          >
            <div className="p-1.5 bg-[#86c7f3]/10 rounded-lg group-hover:scale-110 transition-transform">
              <Activity size={16} className="text-[#86c7f3]" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-zinc-200 text-xs font-bold truncate leading-tight">{selectedAccount.name}</p>
              <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">LIVE Production</p>
            </div>
            <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isDropdownOpen && (
            <div className="absolute top-full right-0 mt-2 w-full bg-[#121212] border border-zinc-800 rounded-xl shadow-2xl z-50 py-2 animate-in slide-in-from-top-2 duration-200 overflow-hidden">
              {LIVE_ACCOUNTS.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => {
                    setSelectedAccount(acc);
                    setIsDropdownOpen(false);
                  }}
                  className={`w-full px-4 py-3 flex items-center gap-3 transition-colors text-left ${selectedAccount.id === acc.id ? 'bg-[#86c7f3]/10' : 'hover:bg-zinc-800/50'}`}
                >
                  <Activity size={14} className={selectedAccount.id === acc.id ? 'text-[#86c7f3]' : 'text-zinc-600'} />
                  <div>
                    <p className={`text-xs font-bold ${selectedAccount.id === acc.id ? 'text-[#86c7f3]' : 'text-zinc-300'}`}>{acc.name}</p>
                    <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">REAL MONEY</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <MetricsGrid 
        totalPnL={2482.12} portfolioEquity={45482.12} positionValue={18124.00} 
        availableCash={27358.12} winRate={64.8} totalTrades={112} 
        profitableTrades={72} lossTrades={40}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-[#121212] border border-zinc-800 rounded-2xl p-6 space-y-6 flex flex-col relative overflow-hidden">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
              <Signal size={14} className="text-[#86c7f3]" /> Bot Status
            </h2>
            <div className="flex items-center gap-3">
               <button onClick={() => setShowSettings(true)} className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-all"><Settings size={16} /></button>
               <div className={`w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`} />
            </div>
          </div>
          <div className="space-y-3.5 flex-1">
            <StatusRow label="Account" value={selectedAccount.name} color="zinc" />
            <StatusRow label="Type" value={accountType} color="emerald" />
            <StatusRow label="Active Bot" value={selectedBot} color="sky" />
            <StatusRow label="Environment" value="Production" color="sky" />
          </div>
          <div className="pt-4 border-t border-zinc-800 space-y-3">
             <div className="flex gap-2">
                <button onClick={() => setIsActive(!isActive)} className={`flex-1 py-2.5 rounded-lg font-bold text-xs uppercase tracking-widest transition-all ${isActive ? 'bg-rose-600/10 text-rose-500 border border-rose-500/20 hover:bg-rose-600/20' : 'bg-[#86c7f3] text-black hover:bg-[#75b7e2]'}`}>{isActive ? 'Stop Execution' : 'Deploy Bot'}</button>
                <button onClick={() => setShowLogs(true)} className="px-4 py-2.5 bg-zinc-800 text-zinc-300 rounded-lg border border-zinc-700 font-bold text-xs uppercase tracking-widest hover:bg-zinc-700 transition-colors">Logs</button>
             </div>
          </div>
        </div>
        <div className="lg:col-span-2 bg-[#121212] rounded-2xl p-6 border border-zinc-800"><PortfolioChart /></div>
      </div>

      <div className="bg-[#121212] border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#171717]/50">
          <div className="flex items-center gap-3"><Clock size={18} className="text-[#86c7f3]" /><h2 className="text-base font-bold text-zinc-200 uppercase tracking-tight">Live Trade Log</h2></div>
          <div className="flex bg-[#0d0d0d] p-1 rounded-xl border border-zinc-800">
            <button onClick={() => setHistoryTab('positions')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${historyTab === 'positions' ? 'bg-[#86c7f3] text-black shadow-lg shadow-[#86c7f3]/20' : 'text-zinc-500 hover:text-zinc-300'}`}>Positions</button>
            <button onClick={() => setHistoryTab('completed')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${historyTab === 'completed' ? 'bg-[#86c7f3] text-black shadow-lg shadow-[#86c7f3]/20' : 'text-zinc-500 hover:text-zinc-300'}`}>History</button>
          </div>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse table-auto min-w-[800px]">
            <thead className="bg-[#171717] text-zinc-500 text-xs font-bold uppercase tracking-widest border-b border-zinc-800">
              <tr><th className="px-6 py-4">Asset</th><th className="px-6 py-4">Execution</th><th className="px-6 py-4 text-center">Qty</th><th className="px-6 py-4">Price</th><th className="px-6 py-4">Total Value</th>{historyTab === 'completed' && <th className="px-6 py-4">Close Event</th>}<th className="px-6 py-4">Realized PnL</th><th className="px-6 py-4 text-right">Order ID</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {(historyTab === 'positions' ? openPositions : completedTrades).map((trade) => (
                <tr key={trade.id} className="hover:bg-zinc-800/20 transition-colors group">
                  <td className="px-6 py-5"><div className="flex flex-col"><span className="font-bold text-zinc-100 text-sm">{trade.ticker}</span><span className="text-xs text-zinc-500 font-medium truncate max-w-[120px]">{trade.companyName}</span></div></td>
                  <td className="px-6 py-5"><div className="flex flex-col gap-1"><div className="flex items-center gap-2"><span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">ENTRY</span><span className="text-xs text-zinc-500 font-medium">{formatTimestamp(trade.buyTimestamp)}</span></div><span className="text-sm font-bold text-zinc-200">${trade.buyPrice.toFixed(2)}</span></div></td>
                  <td className="px-6 py-5 text-sm font-semibold text-zinc-300 text-center">{trade.quantity}</td>
                  <td className="px-6 py-5 text-sm font-bold text-zinc-100">${trade.currentPrice.toFixed(2)}</td>
                  <td className="px-6 py-5 text-sm font-bold text-[#86c7f3]">${(trade.quantity * trade.currentPrice).toLocaleString()}</td>
                  {historyTab === 'completed' && (<td className="px-6 py-5"><div className="flex flex-col gap-1"><div className="flex items-center gap-2"><span className="text-[10px] font-black text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded">EXIT</span><span className="text-xs text-zinc-500 font-medium">{trade.sellTimestamp ? formatTimestamp(trade.sellTimestamp) : '--'}</span></div><span className="text-sm font-bold text-zinc-200">${trade.sellPrice?.toFixed(2) || '--'}</span></div></td>)}
                  <td className={`px-6 py-5 text-sm font-black ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.pnl > 0 ? '+' : ''}{trade.pnl.toFixed(2)}</td>
                  <td className="px-6 py-5 text-xs font-mono text-zinc-600 text-right font-bold">{trade.id.replace('TX-LIVE-', '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const StatusRow = ({ label, value, color }: { label: string, value: string, color: string }) => (
  <div className="flex justify-between items-center text-xs">
    <span className="text-zinc-500 font-bold uppercase tracking-wider">{label}</span>
    <span className={`font-black uppercase tracking-widest truncate max-w-[140px] text-right ${color === 'emerald' ? 'text-emerald-400' : color === 'sky' ? 'text-[#86c7f3]' : 'text-zinc-200'}`}>{value}</span>
  </div>
);

export default LiveTrading;
