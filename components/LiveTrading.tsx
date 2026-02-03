import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import MetricsGrid from './MetricsGrid';
import PortfolioChart from './PortfolioChart';
import BotTile from './BotTile';
import { getCompanyName } from '../lib/ticker-names';
import { Clock, ChevronDown } from 'lucide-react';
import MoneyBagIcon from './MoneyBagIcon';

interface Trade {
  id: number;
  timestamp: string;
  ticker: string;
  action: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  strategy: string;
  pnl: number;
  account_id: string;
  account_name?: string;
  company_name?: string;
  sell_trade_id?: number;
}

interface Position {
  buyTrade: Trade;
  sellTrade?: Trade;
  marketPrice?: number;
  positionValue?: number;
  pnl?: number;
  holdDuration?: string;
}

const LiveTrading: React.FC = () => {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState({ totalPnL: 0, winRate: 0, totalTrades: 0 });
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [portfolioData, setPortfolioData] = useState<{
    portfolio_value: number;
    buying_power: number;
    cash: number;
    positions?: Array<{ symbol: string; qty: number; side: string; market_value: number; unrealized_pl: number; avg_entry_price: number; current_price: number }>;
    completedTrades?: Array<{ symbol: string; qty: number; buyPrice: number; sellPrice: number; buyTime: string; sellTime: string; pnl: number }>;
    activities?: Array<{ symbol?: string; symbol_id?: string; side?: string; transaction_time?: string; trade_time?: string; created_at?: string }>;
    todayGainDollars?: number;
    todayGainPercent?: number;
  } | null>(null);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'POSITIONS' | 'COMPLETED'>('POSITIONS');
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({});
  const accountDropdownRef = useRef<HTMLDivElement>(null);
  const hasAutoSelectedAccount = useRef(false);
  const [searchParams] = useSearchParams();

  // Load accounts from database (same as Settings) and listen for changes
  useEffect(() => {
    const accountIdFromUrl = searchParams.get('account_id');

    const loadAccounts = async () => {
      try {
        const res = await fetch('/api/accounts');
        if (res.ok) {
          const data = await res.json();
          const dbAccounts = Array.isArray(data) ? data.filter((a: any) => a.type === 'Live') : [];
          setAccounts(dbAccounts);
          // If URL has account_id and it's in the list, select it (e.g. from dashboard tile click)
          if (accountIdFromUrl && dbAccounts.some((a: any) => a.id === accountIdFromUrl)) {
            hasAutoSelectedAccount.current = true;
            setSelectedAccountId(accountIdFromUrl);
          } else if (!hasAutoSelectedAccount.current && dbAccounts.length > 0) {
            hasAutoSelectedAccount.current = true;
            setSelectedAccountId(dbAccounts[0].id);
          }
        }
      } catch (error) {
        console.error("Failed to fetch accounts from database:", error);
      }
    };

    loadAccounts();

    const handleFocus = () => {
      loadAccounts();
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [searchParams]);

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

  // Fetch live portfolio from Alpaca when account is selected (includes positions and activities)
  useEffect(() => {
    if (!selectedAccountId) {
      setPortfolioData(null);
      return;
    }
    // Clear stale data immediately when account changes
    setPortfolioData(null);
    const fetchPortfolio = async () => {
      try {
        const res = await fetch(`/api/account-portfolio?account_id=${selectedAccountId}&include_activities=true&include_portfolio_history=true&range=1D`);
        if (res.ok) {
          const data = await res.json();
          setPortfolioData({
            portfolio_value: data.portfolio_value ?? 0,
            buying_power: data.buying_power ?? 0,
            cash: data.cash ?? 0,
            positions: data.positions ?? [],
            completedTrades: data.completedTrades ?? [],
            activities: data.activities ?? [],
            todayGainDollars: data.todayGainDollars ?? 0,
            todayGainPercent: data.todayGainPercent ?? 0,
          });
        } else {
          setPortfolioData(null);
        }
      } catch (error) {
        console.error("Failed to fetch portfolio", error);
        setPortfolioData(null);
      }
    };
    fetchPortfolio();
    const interval = setInterval(fetchPortfolio, 15000);
    return () => clearInterval(interval);
  }, [selectedAccountId]);

  // Fetch trades and stats (always requires account_id for per-account isolation)
  useEffect(() => {
    if (!selectedAccountId) {
      setTrades([]);
      setStats({ totalPnL: 0, winRate: 0, totalTrades: 0 });
      return;
    }
    const fetchData = async () => {
      try {
        const tradesRes = await fetch(`/api/trades?type=Live&account_id=${selectedAccountId}`);
        const statsRes = await fetch(`/api/stats?type=Live&account_id=${selectedAccountId}`);

        if (tradesRes.ok) {
          const tradesData = await tradesRes.json();
          setTrades(Array.isArray(tradesData) ? tradesData : []);
        } else {
          setTrades([]);
        }

        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
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

  const tickersForPrices = portfolioData?.positions?.length
    ? portfolioData.positions.map((p) => p.symbol)
    : [...new Set(trades.map((t) => t.ticker))];
  useEffect(() => {
    const fetchPrices = async () => {
      if (tickersForPrices.length === 0) return;
      try {
        const tickersParam = tickersForPrices.join(',');
        const accountParam = selectedAccountId ? `&account_id=${selectedAccountId}` : '';
        const res = await fetch(`/api/market-prices?tickers=${tickersParam}${accountParam}`);
        if (res.ok) {
          const prices = await res.json();
          setMarketPrices(prices);
        }
      } catch (error) {
        console.error("Failed to fetch market prices", error);
      }
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, [tickersForPrices.join(','), selectedAccountId]);

  // Match trades into positions
  const matchTrades = (): Position[] => {
    const positions: Position[] = [];
    const buyTrades: Trade[] = [];
    
    const sortedTrades = [...trades].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (const trade of sortedTrades) {
      if (trade.action === 'BUY') {
        buyTrades.push(trade);
      } else if (trade.action === 'SELL') {
        const matchingBuy = buyTrades.find(b => 
          b.ticker === trade.ticker && 
          b.account_id === trade.account_id &&
          !positions.some(p => p.buyTrade.id === b.id)
        );
        
        if (matchingBuy) {
          // Use stored PNL from SELL trade if available and non-zero, otherwise calculate
          const pnl = (trade.pnl && trade.pnl !== 0) ? trade.pnl : (trade.price - matchingBuy.price) * matchingBuy.quantity;
          positions.push({
            buyTrade: matchingBuy,
            sellTrade: trade,
            pnl
          });
        }
      }
    }

    for (const buyTrade of buyTrades) {
      if (!positions.some(p => p.buyTrade.id === buyTrade.id)) {
        const marketPrice = marketPrices[buyTrade.ticker];
        positions.push({
          buyTrade: buyTrade,
          marketPrice,
          positionValue: marketPrice ? marketPrice * buyTrade.quantity : undefined
        });
      }
    }

    return positions;
  };

  const formatDateTime = (timestamp: string) => {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    return isNaN(date.getTime())
      ? '--'
      : date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
  };

  const formatNumber = (n: number, decimals = 0) =>
    n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const formatHoldDuration = (buyTime: string, sellTime?: string) => {
    if (!buyTime) return '--';
    const buy = new Date(buyTime);
    if (isNaN(buy.getTime())) return '--';
    const end = sellTime ? new Date(sellTime) : new Date();
    const diffMs = end.getTime() - buy.getTime();
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

  const dbPositions = matchTrades();
  const dbOpenPositions = dbPositions.filter((p) => !p.sellTrade);
  const dbCompletedTrades = dbPositions.filter((p) => p.sellTrade);

  const useAlpacaData = portfolioData?.positions !== undefined && portfolioData?.completedTrades !== undefined;
  const recentCompletedSymbols = new Set(
    (portfolioData?.completedTrades ?? [])
      .filter((ct) => {
        const sellTime = new Date(ct.sellTime).getTime();
        return Date.now() - sellTime < 2 * 60 * 1000; // 2 minutes
      })
      .map((ct) => ct.symbol)
  );
  const alpacaOpenPositions = (portfolioData?.positions ?? [])
    .filter((p) => !recentCompletedSymbols.has(p.symbol))
    .map((p) => {
      const activities = portfolioData?.activities ?? [];
      const buyFill = activities
        .filter((a) => (a.symbol || a.symbol_id) === p.symbol && (a.side || '').toLowerCase() === 'buy')
        .sort((a, b) => {
          const ta = new Date(a.transaction_time || a.trade_time || a.created_at || 0).getTime();
          const tb = new Date(b.transaction_time || b.trade_time || b.created_at || 0).getTime();
          return ta - tb;
        })[0];
      const buyTimestamp = buyFill
        ? (buyFill.transaction_time || buyFill.trade_time || buyFill.created_at || '')
        : (() => {
            const buyTradeFromDb = [...trades]
              .filter((t) => t.ticker === p.symbol && t.action === 'BUY')
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
            return buyTradeFromDb?.timestamp ?? '';
          })();
      return {
        buyTrade: {
          id: p.symbol,
          ticker: p.symbol,
          price: p.avg_entry_price,
          quantity: p.qty,
          timestamp: buyTimestamp,
          action: 'BUY' as const,
          strategy: '',
          pnl: 0,
          account_id: selectedAccountId ?? '',
          company_name: p.symbol,
        },
        marketPrice: p.current_price || marketPrices[p.symbol],
        positionValue: p.market_value,
        pnl: p.unrealized_pl,
      };
    });
  const alpacaCompletedTrades = (portfolioData?.completedTrades ?? []).map((ct) => ({
    buyTrade: {
      id: `${ct.symbol}-${ct.buyTime}`,
      ticker: ct.symbol,
      price: ct.buyPrice,
      quantity: ct.qty,
      timestamp: ct.buyTime,
      action: 'BUY' as const,
      strategy: '',
      pnl: 0,
      account_id: selectedAccountId ?? '',
      company_name: ct.symbol,
    },
    sellTrade: {
      id: `${ct.symbol}-${ct.sellTime}`,
      ticker: ct.symbol,
      price: ct.sellPrice,
      quantity: ct.qty,
      timestamp: ct.sellTime,
      action: 'SELL' as const,
      strategy: '',
      pnl: ct.pnl,
      account_id: selectedAccountId ?? '',
      company_name: ct.symbol,
    },
    pnl: ct.pnl,
  }));

  const openPositions = useAlpacaData ? alpacaOpenPositions : dbOpenPositions;
  const completedTrades = useAlpacaData ? alpacaCompletedTrades : dbCompletedTrades;
  const displayedPositions = viewMode === 'POSITIONS' ? openPositions : completedTrades;

  const selectedAccount = selectedAccountId ? accounts.find(a => a.id === selectedAccountId) : null;

  const startingCapital = 10000; // Default for Live accounts
  const alpacaPositionValue = (portfolioData?.positions ?? []).reduce((s, p) => s + (p.market_value || 0), 0);
  const alpacaTotalTrades = (portfolioData?.completedTrades ?? []).length;
  const alpacaWins = (portfolioData?.completedTrades ?? []).filter((ct) => ct.pnl > 0).length;
  const alpacaWinRate = alpacaTotalTrades > 0 ? ((alpacaWins / alpacaTotalTrades) * 100).toFixed(1) : 0;

  const totalPnL = useAlpacaData
    ? (portfolioData?.completedTrades ?? []).reduce((s, ct) => s + ct.pnl, 0)
    : stats.totalPnL;
  const unrealizedPnL = useAlpacaData
    ? (portfolioData?.positions ?? []).reduce((s, p) => s + (p.unrealized_pl || 0), 0)
    : openPositions.reduce((sum, p) => {
        if (p.marketPrice && p.buyTrade) {
          return sum + (p.marketPrice - p.buyTrade.price) * p.buyTrade.quantity;
        }
        return sum;
      }, 0);
  const positionValue = useAlpacaData ? alpacaPositionValue : openPositions.reduce((sum, p) => sum + (p.positionValue || 0), 0);
  const portfolioEquity = portfolioData?.portfolio_value ?? (startingCapital + totalPnL + unrealizedPnL);
  const availableCash = portfolioData?.buying_power ?? Math.max(0, startingCapital - positionValue + totalPnL);

  const totalTrades = useAlpacaData ? alpacaTotalTrades : stats.totalTrades;
  const winRate = useAlpacaData ? Number(alpacaWinRate) : Number(stats.winRate);
  const profitableTrades = useAlpacaData ? alpacaWins : 0;
  const lossTrades = useAlpacaData ? alpacaTotalTrades - alpacaWins : 0;

  const percentChange = startingCapital > 0 ? ((portfolioEquity - startingCapital) / startingCapital) * 100 : 0;

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
            className={`flex items-center gap-3 bg-[#181818] border transition-all px-4 py-2.5 rounded-xl w-[200px] text-left group ${isAccountDropdownOpen ? 'border-[#86c7f3] ring-2 ring-[#86c7f3]/10' : 'border-zinc-800 hover:border-zinc-700'}`}
          >
            <div className="p-1.5 bg-[#B99DEB]/10 rounded-lg">
              <MoneyBagIcon size={16} className="text-[#B99DEB]" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-zinc-200 text-xs font-bold truncate leading-tight">
                {selectedAccount ? selectedAccount.name : 'Select an Account'}
              </p>
              <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Live Trading</p>
            </div>
            <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-300 ${isAccountDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isAccountDropdownOpen && (
            <div className="absolute top-full right-0 mt-2 w-full bg-[#181818] border border-zinc-800 rounded-xl shadow-2xl z-50 py-2 animate-in slide-in-from-top-2 duration-200 overflow-hidden">
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

      {selectedAccountId ? (
        <>
      <MetricsGrid 
        totalPnL={totalPnL + unrealizedPnL} 
        portfolioEquity={portfolioEquity}
        positionValue={positionValue}
        availableCash={availableCash} 
        winRate={winRate} 
        totalTrades={totalTrades} 
        profitableTrades={profitableTrades} 
        lossTrades={lossTrades}
        percentChange={percentChange}
        todayGainDollars={portfolioData?.todayGainDollars}
        todayGainPercent={portfolioData?.todayGainPercent}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <BotTile
            accent="purple"
            accountId={selectedAccountId}
            onStartBot={async () => {
              if (!selectedAccountId) {
                alert('Please select an account first');
                return;
              }
              const res = await fetch('/api/trading', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ account_id: selectedAccountId, action: 'start' }),
              });
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to start bot');
              }
            }}
            onStopBot={async () => {
              if (!selectedAccountId) {
                alert('Please select an account first');
                return;
              }
              const res = await fetch('/api/trading', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ account_id: selectedAccountId, action: 'stop' }),
              });
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to stop bot');
              }
            }}
            onViewLogs={async () => {
              if (!selectedAccountId) {
                alert('Please select an account first');
                return;
              }
              try {
                const res = await fetch(`/api/trading?account_id=${selectedAccountId}`);
                if (res.ok) {
                  const data = await res.json();
                  const logs = [
                    `Bot Status: ${data.is_running ? 'RUNNING' : 'STOPPED'}`,
                    `Always On: ${data.always_on ? 'YES' : 'NO'}`,
                    `Last Heartbeat: ${data.last_heartbeat || 'Never'}`,
                    `Last Error: ${data.last_error || 'None'}`,
                    `Updated: ${data.updated_at || 'Never'}`,
                  ].join('\n');
                  alert(logs);
                } else {
                  alert('Failed to fetch bot logs');
                }
              } catch (error) {
                alert('Error fetching bot logs: ' + (error instanceof Error ? error.message : 'Unknown error'));
              }
            }}
          />
        </div>
        <div className="lg:col-span-2 bg-[#181818] rounded-2xl p-6 border border-zinc-800">
          <PortfolioChart type="Live" accountId={selectedAccountId} currentEquity={portfolioEquity} />
        </div>
      </div>

      <div className="bg-[#181818] border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#171717]/50">
          <div className="flex items-center gap-3">
            <MoneyBagIcon size={18} className="text-[#B99DEB]" />
            <h2 className="text-base font-bold text-zinc-200 uppercase">TRADE LOG</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('POSITIONS')}
              className={`px-4 py-2 text-xs font-bold uppercase transition-colors ${
                viewMode === 'POSITIONS' 
                  ? 'bg-[#86c7f3] text-white' 
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              } rounded-lg`}
            >
              CURRENT
            </button>
            <button
              onClick={() => setViewMode('COMPLETED')}
              className={`px-4 py-2 text-xs font-bold uppercase transition-colors ${
                viewMode === 'COMPLETED' 
                  ? 'bg-[#86c7f3] text-white' 
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              } rounded-lg`}
            >
              COMPLETED
            </button>
          </div>
        </div>
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-400 min-w-[1200px]">
            <thead className="bg-[#171717] text-xs font-bold uppercase border-b border-zinc-800">
              <tr>
                <th className="px-6 py-4">ASSET</th>
                <th className="px-6 py-4">BUY EVENT</th>
                <th className="px-6 py-4 text-center">QTY</th>
                {viewMode === 'POSITIONS' && <th className="px-6 py-4">MARKET</th>}
                <th className="px-6 py-4">POSITION VALUE</th>
                {viewMode === 'COMPLETED' && <th className="px-6 py-4">SELL EVENT</th>}
                <th className="px-6 py-4">PNL</th>
                <th className="px-6 py-4">HOLD</th>
                <th className="px-6 py-4 text-right">ID</th>
              </tr>
            </thead>
            <tbody key={viewMode} className="divide-y divide-zinc-800/50">
              {displayedPositions.length === 0 ? (
                <tr>
                  <td colSpan={viewMode === 'COMPLETED' ? 8 : 8} className="px-6 py-8 text-center text-zinc-600">
                    {viewMode === 'POSITIONS' ? 'No current positions.' : 'No completed trades.'}
                  </td>
                </tr>
              ) : (
                displayedPositions.map((pos) => {
                  const buy = pos.buyTrade;
                  const sell = pos.sellTrade;
                  const marketPrice = pos.marketPrice || marketPrices[buy.ticker];
                  const positionValue = viewMode === 'COMPLETED' && sell
                    ? sell.price * sell.quantity
                    : pos.positionValue || (marketPrice ? marketPrice * buy.quantity : undefined);
                  const pnl = pos.pnl !== undefined ? pos.pnl : (marketPrice ? (marketPrice - buy.price) * buy.quantity : undefined);
                  
                  return (
                    <tr key={buy.id} className="hover:bg-zinc-800/20">
                      <td className="px-6 py-5">
                        <div className="flex flex-col">
                          <span className="font-bold text-zinc-100 text-sm">{buy.ticker}</span>
                          <span className="text-xs text-zinc-500 font-medium">{getCompanyName(buy.ticker, buy.company_name)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col gap-1 items-center">
                          <span className="inline-flex items-center justify-center min-w-[6rem] w-[6rem] px-2 py-1 rounded text-sm font-black bg-emerald-500 text-white">
                            ${formatNumber(Number(buy.price), 2)}
                          </span>
                          <span className="text-xs text-zinc-400 text-center">{formatDateTime(buy.timestamp)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-center text-sm font-semibold text-zinc-300">{formatNumber(buy.quantity)}</td>
                      {viewMode === 'POSITIONS' && (
                        <td className="px-6 py-5 text-sm font-bold text-zinc-200">
                          {marketPrice ? `$${formatNumber(marketPrice, 2)}` : '--'}
                        </td>
                      )}
                      <td className="px-6 py-5 text-sm font-bold text-[#86c7f3]">
                        {positionValue ? `$${formatNumber(positionValue, 2)}` : '--'}
                      </td>
                      {viewMode === 'COMPLETED' && (
                        <td className="px-6 py-5">
                          {sell ? (
                            <div className="flex flex-col gap-1 items-center">
                              <span className="inline-flex items-center justify-center min-w-[6rem] w-[6rem] px-2 py-1 rounded text-sm font-black bg-[#B99DEB] text-white">
                                ${formatNumber(Number(sell.price), 2)}
                              </span>
                              <span className="text-xs text-zinc-400 text-center">{formatDateTime(sell.timestamp)}</span>
                            </div>
                          ) : (
                            <span className="text-zinc-600">--</span>
                          )}
                        </td>
                      )}
                      <td className={`px-6 py-5 ${
                        pnl !== undefined 
                          ? (pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')
                          : 'text-zinc-600'
                      }`}>
                        {pnl !== undefined ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="font-black text-sm">{pnl >= 0 ? '+' : '-'}${formatNumber(Math.abs(pnl), 2)}</span>
                            <span className="text-xs font-semibold opacity-90">
                              {(() => {
                                const costBasis = buy.price * buy.quantity;
                                if (costBasis <= 0) return '--';
                                const pct = (pnl / costBasis) * 100;
                                return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
                              })()}
                            </span>
                          </div>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="px-6 py-5 text-sm text-zinc-400">
                        {formatHoldDuration(buy.timestamp, sell?.timestamp)}
                      </td>
                      <td className="px-6 py-5 text-right">
                        <span className="text-xs font-mono text-zinc-600 font-bold">#{buy.id}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      ) : accounts.length > 0 ? (
        <div className="bg-[#181818] border border-zinc-800 rounded-2xl p-12 shadow-sm">
          <div className="text-center space-y-3">
            <p className="text-sm font-bold text-zinc-300">Select an Account</p>
            <p className="text-xs text-zinc-500">Please select an account from the dropdown above to view metrics, bot status, and trades.</p>
          </div>
        </div>
      ) : (
        <div className="bg-[#181818] border border-zinc-800 rounded-2xl p-12 shadow-sm">
          <div className="text-center space-y-3">
            <p className="text-sm font-bold text-zinc-300">No Accounts Found</p>
            <p className="text-xs text-zinc-500">Add a Live Trading account in Settings to get started.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveTrading;
