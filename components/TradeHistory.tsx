import React, { useState, useEffect, useRef } from 'react';
import { Clock, ChevronDown, Wallet, Download, Search } from 'lucide-react';
import MoneyBagIcon from './MoneyBagIcon';
import { getCompanyName } from '../lib/ticker-names';

/** One row per completed round-trip (buy + sell on same line) */
interface CompletedTradeRow {
  id: string;
  ticker: string;
  buyPrice: number;
  buyTime: string;
  sellPrice: number;
  sellTime: string;
  qty: number;
  pnl: number;
  account_id: string;
  strategy?: string;
}

const TradeHistory: React.FC = () => {
  const [trades, setTrades] = useState<CompletedTradeRow[]>([]);
  const [filteredTrades, setFilteredTrades] = useState<CompletedTradeRow[]>([]);
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

  // Pair DB trades: BUY with sell_trade_id -> SELL into one row per completed round-trip
  const dbTradesToCompletedRows = (dbTrades: any[]): CompletedTradeRow[] => {
    const byId: Record<number, any> = {};
    dbTrades.forEach((t) => { byId[t.id] = t; });
    const rows: CompletedTradeRow[] = [];
    dbTrades.forEach((t) => {
      if (t.action !== 'BUY' || t.sell_trade_id == null) return;
      const sell = byId[t.sell_trade_id];
      if (!sell || sell.action !== 'SELL') return;
      rows.push({
        id: `db-${t.id}-${sell.id}`,
        ticker: t.ticker,
        buyPrice: Number(t.price),
        buyTime: t.timestamp,
        sellPrice: Number(sell.price),
        sellTime: sell.timestamp,
        qty: t.quantity,
        pnl: Number(sell.pnl ?? 0),
        account_id: t.account_id || '',
        strategy: t.strategy,
      });
    });
    return rows.sort((a, b) => new Date(b.sellTime).getTime() - new Date(a.sellTime).getTime());
  };

  // Fetch completed trades only: one row per round-trip (Alpaca or DB)
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        if (selectedAccountId) {
          const [portfolioRes, dbRes] = await Promise.all([
            fetch(`/api/account-portfolio?account_id=${selectedAccountId}&include_activities=true`),
            fetch(`/api/trades?account_id=${selectedAccountId}${filterType !== 'All' ? `&type=${filterType}` : ''}`),
          ]);

          let portfolioData: { completedTrades?: Array<{ symbol: string; qty: number; buyPrice: number; sellPrice: number; buyTime: string; sellTime: string; pnl: number }> } = {};
          if (portfolioRes.ok) {
            portfolioData = await portfolioRes.json();
          }
          const alpacaCompleted = Array.isArray(portfolioData.completedTrades) ? portfolioData.completedTrades : [];

          if (alpacaCompleted.length > 0) {
            const rows: CompletedTradeRow[] = alpacaCompleted.map((ct, i) => ({
              id: `alpaca-${i}`,
              ticker: ct.symbol,
              buyPrice: ct.buyPrice,
              buyTime: ct.buyTime,
              sellPrice: ct.sellPrice,
              sellTime: ct.sellTime,
              qty: ct.qty,
              pnl: ct.pnl,
              account_id: selectedAccountId,
              strategy: 'Alpaca',
            })).sort((a, b) => new Date(b.sellTime).getTime() - new Date(a.sellTime).getTime());
            setTrades(rows);
          } else {
            const dbData = dbRes.ok ? await dbRes.json() : [];
            setTrades(dbTradesToCompletedRows(Array.isArray(dbData) ? dbData : []));
          }
          return;
        }

        let url = '/api/trades';
        if (filterType !== 'All') url = `/api/trades?type=${filterType}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setTrades(dbTradesToCompletedRows(Array.isArray(data) ? data : []));
        } else {
          setTrades([]);
        }
      } catch (err) {
        console.error("Failed to load history:", err);
        setTrades([]);
      }
    };
    fetchHistory();
  }, [filterType, selectedAccountId]);

  // Filter by search (ticker, strategy, id)
  useEffect(() => {
    const safeTrades = Array.isArray(trades) ? trades : [];
    if (!searchQuery.trim()) {
      setFilteredTrades(safeTrades);
      return;
    }
    const lowerQuery = searchQuery.toLowerCase();
    setFilteredTrades(safeTrades.filter((t) =>
      t.ticker.toLowerCase().includes(lowerQuery) ||
      (t.strategy && t.strategy.toLowerCase().includes(lowerQuery)) ||
      t.id.toString().toLowerCase().includes(lowerQuery)
    ));
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

  const formatNumber = (n: number, decimals = 0) =>
    n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const formatDateTime = (ts: string) =>
    new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const formatHoldDuration = (buyTime: string, sellTime: string) => {
    const buy = new Date(buyTime);
    const sell = new Date(sellTime);
    if (isNaN(buy.getTime()) || isNaN(sell.getTime())) return '--';
    const diffMs = sell.getTime() - buy.getTime();
    if (diffMs < 0) return '--';
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    const hours = diffHours % 24;
    const mins = diffMins % 60;
    const parts: string[] = [];
    if (diffDays > 0) parts.push(`${diffDays}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
    return parts.join(' ');
  };

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
              <div className={`p-1.5 rounded-lg ${filterType === 'Live' ? 'bg-[#B99DEB]/10' : 'bg-[#86c7f3]/10'}`}>
                {filterType === 'Live' ? <MoneyBagIcon size={16} className="text-[#B99DEB]" /> : <Wallet size={16} className="text-[#86c7f3]" />}
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
              <div className={`p-1.5 rounded-lg ${filterType === 'Live' ? 'bg-[#B99DEB]/10' : 'bg-[#86c7f3]/10'}`}>
                {filterType === 'Live' ? <MoneyBagIcon size={16} className="text-[#B99DEB]" /> : <Wallet size={16} className="text-[#86c7f3]" />}
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
            <h2 className="text-base font-bold text-zinc-200 uppercase tracking-tight">Completed Trades</h2>
          </div>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-400 border-collapse table-auto min-w-[1000px]">
            <thead className="bg-[#171717] text-xs font-bold uppercase tracking-widest border-b border-zinc-800">
              <tr>
                <th className="px-6 py-4">Asset</th>
                <th className="px-6 py-4">Buy Event</th>
                <th className="px-6 py-4 text-center">Qty</th>
                <th className="px-6 py-4">Position Value</th>
                <th className="px-6 py-4">Sell Event</th>
                <th className="px-6 py-4">PnL</th>
                <th className="px-6 py-4">Hold</th>
                <th className="px-6 py-4 text-right">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {filteredTrades.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-zinc-500 text-sm">No completed trades found.</td></tr>
              ) : (
                filteredTrades.map((trade) => {
                  const positionValue = trade.sellPrice * trade.qty;
                  const costBasis = trade.buyPrice * trade.qty;
                  const pnlPct = costBasis > 0 ? (trade.pnl / costBasis) * 100 : 0;
                  return (
                    <tr key={trade.id} className="hover:bg-zinc-800/20 transition-colors">
                      <td className="px-6 py-5">
                        <div className="flex flex-col">
                          <span className="font-bold text-zinc-100 text-sm">{trade.ticker}</span>
                          <span className="text-xs text-zinc-500 font-medium truncate max-w-[120px]">{getCompanyName(trade.ticker, trade.strategy || '—')}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="inline-flex px-2 py-1 rounded text-sm font-black bg-emerald-500 text-white">${formatNumber(trade.buyPrice, 2)}</span>
                          <span className="text-xs text-zinc-400">{formatDateTime(trade.buyTime)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-center text-sm font-semibold text-zinc-300">{formatNumber(trade.qty)}</td>
                      <td className="px-6 py-5 text-sm font-bold text-[#86c7f3]">${formatNumber(positionValue, 2)}</td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="inline-flex px-2 py-1 rounded text-sm font-black bg-rose-500 text-white">${formatNumber(trade.sellPrice, 2)}</span>
                          <span className="text-xs text-zinc-400">{formatDateTime(trade.sellTime)}</span>
                        </div>
                      </td>
                      <td className={`px-6 py-5 ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-black text-sm">{trade.pnl >= 0 ? '+' : ''}${formatNumber(Math.abs(trade.pnl), 2)}</span>
                          <span className="text-xs font-semibold opacity-90">{trade.pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-sm text-zinc-400">{formatHoldDuration(trade.buyTime, trade.sellTime)}</td>
                      <td className="px-6 py-5 text-right">
                        <span className="text-xs font-mono text-zinc-600 font-bold">#{trade.id}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TradeHistory;