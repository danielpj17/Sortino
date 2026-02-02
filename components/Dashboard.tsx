import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import PortfolioChart, { type TimeRange } from './PortfolioChart';
import { Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import MoneyBagIcon from './MoneyBagIcon';

interface DashboardAccount {
  id: string;
  name: string;
  equity: number;
  gainDollars: number;
  gainPercent: number;
}

interface DashboardSummary {
  combinedHistory: { time: string; value: number }[];
  combinedEquity: number;
  combinedGainDollars: number;
  combinedGainPercent: number;
  accounts: DashboardAccount[];
}

const Dashboard: React.FC = () => {
  const [range, setRange] = useState<TimeRange>('1D');
  const [paperSummary, setPaperSummary] = useState<DashboardSummary | null>(null);
  const [liveSummary, setLiveSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummaries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [paperRes, liveRes] = await Promise.all([
        fetch(`/api/dashboard-summary?type=Paper&range=${range}`),
        fetch(`/api/dashboard-summary?type=Live&range=${range}`),
      ]);
      if (paperRes.ok) {
        const data = await paperRes.json();
        setPaperSummary(data);
      } else {
        setPaperSummary(null);
      }
      if (liveRes.ok) {
        const data = await liveRes.json();
        setLiveSummary(data);
      } else {
        setLiveSummary(null);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard summary', err);
      setError('Unable to load dashboard data.');
      setPaperSummary(null);
      setLiveSummary(null);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchSummaries();
    const interval = setInterval(fetchSummaries, 30000);
    return () => clearInterval(interval);
  }, [fetchSummaries]);

  const formatNumber = (n: number, decimals = 0) =>
    n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-full overflow-x-hidden">
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/50 rounded-xl p-4 text-rose-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
        <p className="text-zinc-500 text-sm font-medium">Paper and Live combined performance.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Paper Trading */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#86c7f3]/10 rounded-lg">
              <Wallet size={18} className="text-[#86c7f3]" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-200">Paper Trading</h2>
          </div>

          <div className="bg-[#181818] rounded-2xl p-6 border border-zinc-800 shadow-sm space-y-4">
            {loading && !paperSummary ? (
              <div className="h-[320px] flex items-center justify-center text-zinc-500 text-sm">
                Loading...
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Total Portfolio Equity</p>
                  <p className="text-xl font-bold text-white">
                    ${formatNumber(paperSummary?.combinedEquity ?? 0, 2)}
                  </p>
                </div>
                <PortfolioChart
                  history={paperSummary?.combinedHistory ?? []}
                  currentEquity={paperSummary?.combinedEquity}
                  range={range}
                  onRangeChange={setRange}
                  accent="sky"
                />
              </>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Accounts</p>
            {paperSummary?.accounts && paperSummary.accounts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {paperSummary.accounts.map((acc) => (
                  <AccountTile
                    key={acc.id}
                    name={acc.name}
                    equity={acc.equity}
                    gainDollars={acc.gainDollars}
                    gainPercent={acc.gainPercent}
                    accent="sky"
                    to={`/paper?account_id=${encodeURIComponent(acc.id)}`}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-[#181818] border border-zinc-800 rounded-xl p-6 text-center text-zinc-500 text-sm">
                No Paper Trading accounts. Add one in Settings.
              </div>
            )}
          </div>
        </div>

        {/* Right: Live Trading */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#B99DEB]/10 rounded-lg">
              <MoneyBagIcon size={18} className="text-[#B99DEB]" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-200">Live Trading</h2>
          </div>

          <div className="bg-[#181818] rounded-2xl p-6 border border-zinc-800 shadow-sm space-y-4">
            {loading && !liveSummary ? (
              <div className="h-[320px] flex items-center justify-center text-zinc-500 text-sm">
                Loading...
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Total Portfolio Equity</p>
                  <p className="text-xl font-bold text-white">
                    ${formatNumber(liveSummary?.combinedEquity ?? 0, 2)}
                  </p>
                </div>
                <PortfolioChart
                  history={liveSummary?.combinedHistory ?? []}
                  currentEquity={liveSummary?.combinedEquity}
                  range={range}
                  onRangeChange={setRange}
                  accent="rose"
                />
              </>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Accounts</p>
            {liveSummary?.accounts && liveSummary.accounts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {liveSummary.accounts.map((acc) => (
                  <AccountTile
                    key={acc.id}
                    name={acc.name}
                    equity={acc.equity}
                    gainDollars={acc.gainDollars}
                    gainPercent={acc.gainPercent}
                    accent="rose"
                    to={`/live?account_id=${encodeURIComponent(acc.id)}`}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-[#181818] border border-zinc-800 rounded-xl p-6 text-center text-zinc-500 text-sm">
                No Live Trading accounts. Add one in Settings.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface AccountTileProps {
  name: string;
  equity: number;
  gainDollars: number;
  gainPercent: number;
  accent: 'sky' | 'rose';
  to?: string;
}

const AccountTile: React.FC<AccountTileProps> = ({ name, equity, gainDollars, gainPercent, accent, to }) => {
  const formatNumber = (n: number, decimals = 0) =>
    n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const isPositive = gainDollars >= 0;

  const tileContent = (
    <>
      <div className="flex justify-between items-start mb-3">
        <div className={`p-2 rounded-lg ${accent === 'rose' ? 'bg-[#B99DEB]/10 text-[#B99DEB]' : 'bg-[#86c7f3]/10 text-[#86c7f3]'}`}>
          {accent === 'rose' ? <MoneyBagIcon size={18} /> : <Wallet size={18} />}
        </div>
        <div className={`flex items-center gap-1 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full ${isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
          {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          {Math.abs(gainPercent).toFixed(2)}%
        </div>
      </div>
      <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-1">{name}</p>
      <p className="text-xl font-bold tracking-tight text-white leading-none">${formatNumber(equity, 2)}</p>
      <div className="text-[10px] font-bold text-zinc-500 mt-2 uppercase tracking-wide">
        {isPositive ? '+' : ''}${formatNumber(gainDollars, 2)} ({isPositive ? '+' : ''}{gainPercent.toFixed(2)}%)
      </div>
    </>
  );

  const className = "bg-[#181818] border border-zinc-800/80 p-5 rounded-xl shadow-sm hover:border-zinc-700 transition-colors block";

  if (to) {
    return (
      <Link to={to} className={className}>
        {tileContent}
      </Link>
    );
  }

  return (
    <div className={className}>
      {tileContent}
    </div>
  );
};

export default Dashboard;
