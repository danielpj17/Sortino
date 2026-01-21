
import React, { useState, useRef, useEffect } from 'react';
import MetricsGrid from './MetricsGrid';
import PortfolioChart from './PortfolioChart';
import { Signal, X, Clock, ChevronDown, Settings, ShieldCheck, Activity, Search } from 'lucide-react';
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

const ACCOUNTS = [
  { id: 'acc-001', name: 'Standard Strategy', type: 'Paper' },
  { id: 'acc-002', name: 'Aggressive Alpha', type: 'Paper' },
  { id: 'acc-003', name: 'Long Term Growth', type: 'Paper' },
];

const BOTS = ['Alpha-01', 'Beta-Sage', 'Zeta-Core', 'PPO-Alpha-v1'];
const ACCOUNT_TYPES = ['Cash', 'Margin'];

const PaperTrading: React.FC = () => {
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [historyTab, setHistoryTab] = useState<'positions' | 'completed'>('positions');
  
  const [selectedAccount, setSelectedAccount] = useState(ACCOUNTS[0]);
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
    "Agent initialized...",
    "Connecting to Alpaca Paper Trading API...",
    "Model 'aapl_model.zip' loaded successfully.",
    "Bot searching for trade opportunities...",
    "Market depth analyzed for ticker AAPL",
    "No signal detected. Sleeping for 60s..."
  ];

  const openPositions: ExtendedTrade[] = [
    { id: "TX-90210", ticker: 'AAPL', companyName: 'Apple Inc.', buyTimestamp: new Date(Date.now() - 4500000).toISOString(), buyPrice: 172.45, currentPrice: 175.40, quantity: 10, pnl: 29.50 },
    { id: "TX-88312", ticker: 'NVDA', companyName: 'NVIDIA Corp.', buyTimestamp: new Date(Date.now() - 3600000).toISOString(), buyPrice: 885.10, currentPrice: 882.10, quantity: 5, pnl: -15.00 },
  ];

  const completedTrades: ExtendedTrade[] = [
    { id: "TX-77123", ticker: 'TSLA', companyName: 'Tesla, Inc.', buyTimestamp: new Date(Date.now() - 86400000).toISOString(), buyPrice: 175.20, sellTimestamp: new Date(Date.now() - 82800000).toISOString(), sellPrice: 182.30, currentPrice: 182.30, quantity: 15, pnl: 106.50 },
    { id: "TX-66234", ticker: 'MSFT', companyName: 'Microsoft', buyTimestamp: new Date(Date.now() - 172800000).toISOString(), buyPrice: 418.50, sellTimestamp: new Date(Date.now() - 169200000).toISOString(), sellPrice: 415.10, currentPrice: 415.10, quantity: 8, pnl: -27.20 },
  ];

  const formatTimestamp = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-full overflow-x-hidden">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Paper Trading</h1>
          <p className="text-zinc-500 text-sm font-medium">Simulated engine with live performance tracking.</p>
        </div>
        
        <div className="relative" ref={dropdownRef}>
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1.5 block px-1">Active Account</label>
          <button 
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className={`flex items-center gap-3 bg-[#121212] border transition-all px-4 py-2.5 rounded-xl w-[240px] text-left group ${isDropdownOpen ? 'border-[#86c7f3] ring-2 ring-[#86c7f3]/10' : 'border-zinc-800 hover:border-zinc-700'}`}
          >
            <div className="p-1.5 bg-[#86c7f3]/10 rounded-lg group-hover:scale-110 transition-transform">
              <ShieldCheck size={16} className="text-[#86c7f3]" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-zinc-200 text-xs font-bold truncate leading-tight">{selectedAccount.name}</p>
              <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{selectedAccount.type} Environment</p>
            </div>
            <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isDropdownOpen && (
            <div className="absolute top-full right-0 mt-2 w-full bg-[#121212] border border-zinc-800 rounded-xl shadow-2xl z-50 py-2 animate-in slide-in-from-top-2 duration-200 overflow-hidden">
              {ACCOUNTS.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => {
                    setSelectedAccount(acc);
                    setIsDropdownOpen(false);
                  }}
                  className={`w-full px-4 py-3 flex items-center gap-3 transition-colors text-left ${selectedAccount.id === acc.id ? 'bg-[#86c7f3]/10' : 'hover:bg-zinc-800/50'}`}
                >
                  <ShieldCheck size={14} className={selectedAccount.id === acc.id ? 'text-[#86c7f3]' : 'text-zinc-600'} />
                  <div>
                    <p className={`text-xs font-bold ${selectedAccount.id === acc.id ? 'text-[#86c7f3]' : 'text-zinc-300'}`}>{acc.name}</p>
                    <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">ID: {acc.id}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <MetricsGrid 
        totalPnL={452.12} portfolioEquity={10452.12} positionValue={6154.20} 
        availableCash={4297.92} winRate={71.2} totalTrades={58} 
        profitableTrades={41} lossTrades={17}
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
            <StatusRow label="API" value="Connected" color="emerald" />
          </div>
          <div className="pt-4 border-t border-zinc-800 space-y-3">
             <div className="flex gap-2">
                <button onClick={() => setIsActive(!isActive)} className={`flex-1 py-2.5 rounded-lg font-bold text-xs uppercase tracking-widest transition-all ${isActive ? 'bg-rose-600/10 text-rose-500 border border-rose-500/20 hover:bg-rose-600/20' : 'bg-[#86c7f3] text-black hover:bg-[#75b7e2]'}`}>{isActive ? 'Pause Bot' : 'Start Bot'}</button>
                <button onClick={() => setShowLogs(true)} className="px-4 py-2.5 bg-zinc-800 text-zinc-300 rounded-lg border border-zinc-700 font-bold text-xs uppercase tracking-widest hover:bg-zinc-700 transition-colors">Logs</button>
             </div>
          </div>
        </div>
        <div className="lg:col-span-2 bg-[#121212] rounded-2xl p-6 border border-zinc-800"><PortfolioChart /></div>
      </div>

      <div className="bg-[#121212] border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#171717]/50">
          <div className="flex items-center gap-3">
            <Clock size={18} className="text-[#86c7f3]" />
            <h2 className="text-base font-bold text-zinc-200 uppercase tracking-tight">Trade Log</h2>
          </div>
          <div className="flex bg-[#0d0d0d] p-1 rounded-xl border border-zinc-800">
            <button onClick={() => setHistoryTab('positions')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${historyTab === 'positions' ? 'bg-[#86c7f3] text-black shadow-lg shadow-[#86c7f3]/20' : 'text-zinc-500 hover:text-zinc-300'}`}>Positions</button>
            <button onClick={() => setHistoryTab('completed')} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${historyTab === 'completed' ? 'bg-[#86c7f3] text-black shadow-lg shadow-[#86c7f3]/20' : 'text-zinc-500 hover:text-zinc-300'}`}>Completed</button>
          </div>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse table-auto min-w-[800px]">
            <thead className="bg-[#171717] text-zinc-500 text-xs font-bold uppercase tracking-widest border-b border-zinc-800">
              <tr>
                <th className="px-6 py-4">Asset</th>
                <th className="px-6 py-4">Buy Event</th>
                <th className="px-6 py-4 text-center">Qty</th>
                <th className="px-6 py-4">Market</th>
                <th className="px-6 py-4">Position Value</th>
                {historyTab === 'completed' && <th className="px-6 py-4">Sell Event</th>}
                <th className="px-6 py-4">PnL</th>
                <th className="px-6 py-4">Hold</th>
                <th className="px-6 py-4 text-right">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {(historyTab === 'positions' ? openPositions : completedTrades).map((trade) => (
                <tr key={trade.id} className="hover:bg-zinc-800/20 transition-colors group">
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-bold text-zinc-100 text-sm tracking-tight">{trade.ticker}</span>
                      <span className="text-xs text-zinc-500 font-medium truncate max-w-[120px]">{trade.companyName}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">BUY</span>
                        <span className="text-xs text-zinc-500 font-medium">{formatTimestamp(trade.buyTimestamp)}</span>
                      </div>
                      <span className="text-sm font-bold text-zinc-200 tracking-tight">${trade.buyPrice.toFixed(2)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-sm font-semibold text-zinc-300 text-center">{trade.quantity}</td>
                  <td className="px-6 py-5 text-sm font-bold text-zinc-100 tracking-tight">${trade.currentPrice.toFixed(2)}</td>
                  <td className="px-6 py-5 text-sm font-bold text-[#86c7f3] tracking-tight">${(trade.quantity * trade.currentPrice).toLocaleString()}</td>
                  {historyTab === 'completed' && (
                    <td className="px-6 py-5">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2"><span className="text-[10px] font-black text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded">SELL</span><span className="text-xs text-zinc-500 font-medium">{trade.sellTimestamp ? formatTimestamp(trade.sellTimestamp) : '--'}</span></div>
                        <span className="text-sm font-bold text-zinc-200 tracking-tight">${trade.sellPrice?.toFixed(2) || '--'}</span>
                      </div>
                    </td>
                  )}
                  <td className={`px-6 py-5 text-sm font-black ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.pnl > 0 ? '+' : ''}{trade.pnl.toFixed(2)}</td>
                  <td className="px-6 py-5 text-xs text-zinc-400 font-bold uppercase tracking-wider">--</td>
                  <td className="px-6 py-5 text-xs font-mono text-zinc-600 text-right font-bold">{trade.id.split('-')[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0d0d0d] border border-zinc-800 w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95">
            <div className="bg-[#171717] px-6 py-4 flex items-center justify-between border-b border-zinc-800">
              <span className="text-xs font-bold text-zinc-400 tracking-widest uppercase">Agent Output</span>
              <button onClick={() => setShowLogs(false)} className="text-zinc-500 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-6 font-mono text-xs h-80 overflow-y-auto space-y-2 text-zinc-400">
              {logs.map((log, i) => (<div key={i} className="flex gap-3"><span className="text-zinc-700">[{formatTimestamp(new Date().toISOString())}]</span><span className="text-[#86c7f3] font-bold">LOG:</span><span>{log}</span></div>))}
            </div>
            <div className="bg-[#121212] px-6 py-4 border-t border-zinc-800 flex justify-end"><button onClick={() => setShowLogs(false)} className="px-6 py-2 bg-[#86c7f3] text-black font-bold text-xs uppercase tracking-widest rounded-lg">Close</button></div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#121212] border border-zinc-800 w-full max-w-sm rounded-2xl overflow-hidden animate-in zoom-in-95">
            <div className="bg-[#171717] px-6 py-4 flex items-center justify-between border-b border-zinc-800"><span className="text-xs font-bold text-zinc-400 tracking-widest uppercase">Configure Agent</span><button onClick={() => setShowSettings(false)} className="text-zinc-500 hover:text-white"><X size={18} /></button></div>
            <div className="p-6 space-y-6">
              <div className="space-y-2"><label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Strategy Bot</label>
                <div className="grid grid-cols-1 gap-2">
                  {BOTS.map(bot => (<button key={bot} onClick={() => setSelectedBot(bot)} className={`px-4 py-3 rounded-xl text-left text-sm font-bold transition-all border ${selectedBot === bot ? 'bg-[#86c7f3]/10 border-[#86c7f3] text-[#86c7f3]' : 'bg-zinc-900/50 border-zinc-800 text-zinc-500'}`}>{bot}</button>))}
                </div>
              </div>
              <div className="space-y-2"><label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Capital Configuration</label>
                <div className="flex gap-2">
                  {ACCOUNT_TYPES.map(type => (<button key={type} onClick={() => setAccountType(type)} className={`flex-1 px-4 py-3 rounded-xl text-center text-sm font-bold border ${accountType === type ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-zinc-900/50 border-zinc-800 text-zinc-500'}`}>{type}</button>))}
                </div>
              </div>
            </div>
            <div className="bg-[#171717] px-6 py-4 border-t border-zinc-800"><button onClick={() => setShowSettings(false)} className="w-full py-2.5 bg-[#86c7f3] text-black font-bold text-xs uppercase tracking-widest rounded-lg shadow-lg shadow-[#86c7f3]/20">Save Configuration</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatusRow = ({ label, value, color }: { label: string, value: string, color: string }) => (
  <div className="flex justify-between items-center text-xs">
    <span className="text-zinc-500 font-bold uppercase tracking-wider">{label}</span>
    <span className={`font-black uppercase tracking-widest truncate max-w-[140px] text-right ${color === 'emerald' ? 'text-emerald-400' : color === 'sky' ? 'text-[#86c7f3]' : 'text-zinc-200'}`}>{value}</span>
  </div>
);

export default PaperTrading;
