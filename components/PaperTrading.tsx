import React, { useState, useEffect, useRef } from 'react';
import MetricsGrid from './MetricsGrid';
import PortfolioChart from './PortfolioChart';
import BotTile from './BotTile';
import { Clock, ShieldCheck, ChevronDown } from 'lucide-react';

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

const PaperTrading: React.FC = () => {
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
  } | null>(null);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'POSITIONS' | 'COMPLETED'>('POSITIONS');
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({});
  const accountDropdownRef = useRef<HTMLDivElement>(null);
  const hasAutoSelectedAccount = useRef(false);

  // Load accounts from database (accounts must exist in DB for bot to work)
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const res = await fetch('/api/accounts');
        if (res.ok) {
          const data = await res.json();
          const dbAccounts = Array.isArray(data) ? data.filter((a: any) => a.type === 'Paper') : [];
          setAccounts(dbAccounts);
          // Auto-select: prefer "Sortino Model", else first account. Always select when accounts exist.
          if (!hasAutoSelectedAccount.current && dbAccounts.length > 0) {
            hasAutoSelectedAccount.current = true;
            const sortinoAccount = dbAccounts.find((a: any) =>
              a.name && String(a.name).toLowerCase().includes('sortino')
            );
            setSelectedAccountId(sortinoAccount ? sortinoAccount.id : dbAccounts[0].id);
          }
        }
      } catch (error) {
        console.error("Failed to fetch accounts from database:", error);
      }
    };

    // Load accounts on mount
    loadAccounts();

    // Reload accounts when window regains focus (in case accounts were updated in another tab)
    const handleFocus = () => {
      loadAccounts();
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
    };
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

  // Fetch live portfolio from Alpaca when account is selected (includes positions and activities)
  useEffect(() => {
    if (!selectedAccountId) {
      setPortfolioData(null);
      return;
    }
    const fetchPortfolio = async () => {
      try {
        const res = await fetch(`/api/account-portfolio?account_id=${selectedAccountId}&include_activities=true`);
        if (res.ok) {
          const data = await res.json();
          setPortfolioData({
            portfolio_value: data.portfolio_value ?? 0,
            buying_power: data.buying_power ?? 0,
            cash: data.cash ?? 0,
            positions: data.positions ?? [],
            completedTrades: data.completedTrades ?? [],
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
        const tradesRes = await fetch(`/api/trades?type=Paper&account_id=${selectedAccountId}`);
        const statsRes = await fetch(`/api/stats?type=Paper&account_id=${selectedAccountId}`);

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
        console.error("Failed to fetch paper data", error);
        setTrades([]);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [selectedAccountId]);

  // Fetch market prices for tickers from Alpaca positions or DB trades
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
    
    // Sort trades by timestamp
    const sortedTrades = [...trades].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (const trade of sortedTrades) {
      if (trade.action === 'BUY') {
        buyTrades.push(trade);
      } else if (trade.action === 'SELL') {
        // Match with earliest unmatched BUY (FIFO)
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

    // Add unmatched BUY trades as open positions
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

  const formatTime = (timestamp: string) => {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? '--' : date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const formatHoldDuration = (buyTime: string, sellTime?: string) => {
    if (!sellTime) return '--';
    const buy = new Date(buyTime);
    const sell = new Date(sellTime);
    const diffMs = sell.getTime() - buy.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) return `${diffDays}d`;
    if (diffHours > 0) return `${diffHours}h`;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    return `${diffMins}m`;
  };

  const dbPositions = matchTrades();
  const dbOpenPositions = dbPositions.filter((p) => !p.sellTrade);
  const dbCompletedTrades = dbPositions.filter((p) => p.sellTrade);

  const useAlpacaData = portfolioData?.positions !== undefined && portfolioData?.completedTrades !== undefined;
  const alpacaOpenPositions = (portfolioData?.positions ?? []).map((p) => ({
    buyTrade: {
      id: p.symbol,
      ticker: p.symbol,
      price: p.avg_entry_price,
      quantity: p.qty,
      timestamp: '',
      action: 'BUY' as const,
      strategy: '',
      pnl: 0,
      account_id: selectedAccountId ?? '',
      company_name: p.symbol,
    },
    marketPrice: p.current_price || marketPrices[p.symbol],
    positionValue: p.market_value,
    pnl: p.unrealized_pl,
  }));
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

  const selectedAccount = selectedAccountId ? accounts.find((a) => a.id === selectedAccountId) : null;

  const startingCapital = 100000;
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
          <h1 className="text-2xl font-bold text-white">Paper Trading</h1>
          <p className="text-zinc-500 text-sm">Simulated engine with live performance tracking.</p>
        </div>
        
        {/* Account Dropdown */}
        <div className="relative" ref={accountDropdownRef}>
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1.5 block px-1">Account</label>
          <button 
            onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
            className={`flex items-center gap-3 bg-[#181818] border transition-all px-4 py-2.5 rounded-xl w-[200px] text-left group ${isAccountDropdownOpen ? 'border-[#86c7f3] ring-2 ring-[#86c7f3]/10' : 'border-zinc-800 hover:border-zinc-700'}`}
          >
            <div className="p-1.5 bg-[#86c7f3]/10 rounded-lg">
              <ShieldCheck size={16} className="text-[#86c7f3]" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-zinc-200 text-xs font-bold truncate leading-tight">
                {selectedAccount ? selectedAccount.name : 'Select an Account'}
              </p>
              <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Paper Trading</p>
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

      {/* Dynamic Metrics - only when account selected */}
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
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
            <BotTile
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
          <PortfolioChart type="Paper" accountId={selectedAccountId} currentEquity={portfolioEquity} />
        </div>
      </div>

      {/* Trade Log */}
      <div className="bg-[#181818] border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#171717]/50">
          <div className="flex items-center gap-3">
            <Clock size={18} className="text-[#86c7f3]" />
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
              POSITIONS
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
                <th className="px-6 py-4">MARKET</th>
                <th className="px-6 py-4">POSITION VALUE</th>
                {viewMode === 'COMPLETED' && <th className="px-6 py-4">SELL EVENT</th>}
                <th className="px-6 py-4">PNL</th>
                <th className="px-6 py-4">HOLD</th>
                <th className="px-6 py-4 text-right">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {displayedPositions.length === 0 ? (
                <tr>
                  <td colSpan={viewMode === 'COMPLETED' ? 9 : 8} className="px-6 py-8 text-center text-zinc-600">
                    {viewMode === 'POSITIONS' ? 'No open positions.' : 'No completed trades.'}
                  </td>
                </tr>
              ) : (
                displayedPositions.map((pos) => {
                  const buy = pos.buyTrade;
                  const sell = pos.sellTrade;
                  const marketPrice = pos.marketPrice || marketPrices[buy.ticker];
                  const positionValue = pos.positionValue || (marketPrice ? marketPrice * buy.quantity : undefined);
                  const pnl = pos.pnl !== undefined ? pos.pnl : (marketPrice ? (marketPrice - buy.price) * buy.quantity : undefined);
                  
                  return (
                    <tr key={buy.id} className="hover:bg-zinc-800/20">
                      <td className="px-6 py-5">
                        <div className="flex flex-col">
                          <span className="font-bold text-zinc-100 text-sm">{buy.ticker}</span>
                          <span className="text-xs text-zinc-500 font-medium">{buy.company_name || buy.ticker}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col gap-1">
                          <span className="px-2 py-1 rounded text-[10px] font-black uppercase bg-emerald-500 text-white w-fit">
                            BUY
                          </span>
                          <span className="text-xs text-zinc-400">{formatTime(buy.timestamp)}</span>
                          <span className="text-xs font-bold text-zinc-200">${Number(buy.price).toFixed(2)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-center text-sm font-semibold text-zinc-300">{buy.quantity}</td>
                      <td className="px-6 py-5 text-sm font-bold text-zinc-200">
                        {marketPrice ? `$${marketPrice.toFixed(2)}` : '--'}
                      </td>
                      <td className="px-6 py-5 text-sm font-bold text-[#86c7f3]">
                        {positionValue ? `$${positionValue.toFixed(2)}` : '--'}
                      </td>
                      {viewMode === 'COMPLETED' && (
                        <td className="px-6 py-5">
                          {sell ? (
                            <div className="flex flex-col gap-1">
                              <span className="px-2 py-1 rounded text-[10px] font-black uppercase bg-rose-500 text-white w-fit">
                                SELL
                              </span>
                              <span className="text-xs text-zinc-400">{formatTime(sell.timestamp)}</span>
                              <span className="text-xs font-bold text-zinc-200">${Number(sell.price).toFixed(2)}</span>
                            </div>
                          ) : (
                            <span className="text-zinc-600">--</span>
                          )}
                        </td>
                      )}
                      <td className={`px-6 py-5 text-sm font-black ${
                        pnl !== undefined 
                          ? (pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')
                          : 'text-zinc-600'
                      }`}>
                        {pnl !== undefined ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}` : '--'}
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
            <p className="text-xs text-zinc-500">Add a Paper Trading account in Settings to get started.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaperTrading;
