import React, { useState, useEffect } from 'react';
import { Settings, Play, FileText } from 'lucide-react';
import ConfigureAgentModal from './ConfigureAgentModal';

const LIVE_ACCENT = '#B99DEB';

interface BotTileProps {
  accountId?: string | null;
  onStartBot?: () => void;
  onStopBot?: () => void;
  onViewLogs?: () => void;
  /** When 'purple', use purple for stop/error accent (Live trading). Default keeps rose. */
  accent?: 'rose' | 'purple';
}

const BotTile: React.FC<BotTileProps> = ({ accountId, onStartBot, onStopBot, onViewLogs, accent = 'rose' }) => {
  const stopColor = accent === 'purple' ? LIVE_ACCENT : undefined;
  const stopClasses = stopColor
    ? `flex-1 text-white font-bold text-xs uppercase tracking-widest py-3 px-4 rounded-xl transition-colors disabled:opacity-50 hover:opacity-90`
    : 'flex-1 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-widest py-3 px-4 rounded-xl transition-colors';
  const statusErrorClass = accent === 'purple' ? 'text-[#B99DEB]' : 'text-rose-400';
  const statusErrorMutedClass = accent === 'purple' ? 'text-[#B99DEB]/70' : 'text-rose-400/70';
  const [botStatus, setBotStatus] = useState({
    account_name: 'STANDARD STRATEGY',
    bot_name: 'ALPHA-01',
    account_type_display: 'CASH',
    strategy_name: "Sortino Model",
    api_status: 'CONNECTED',
    api_error: null as string | null
  });
  const [isRunning, setIsRunning] = useState(false);
  const [botActionLoading, setBotActionLoading] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

  const fetchBotStatus = async () => {
    try {
      const url = accountId ? `/api/bot-status?account_id=${accountId}` : '/api/bot-status';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setBotStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch bot status", error);
    }
  };

  const fetchBotState = async () => {
    if (!accountId) return;
    try {
      const res = await fetch(`/api/trading?account_id=${accountId}`);
      if (res.ok) {
        const data = await res.json();
        setIsRunning(!!data.is_running);
      }
    } catch (error) {
      console.error("Failed to fetch bot state", error);
    }
  };

  useEffect(() => {
    fetchBotStatus();
    fetchBotState();
    const t = setInterval(() => {
      fetchBotStatus();
      fetchBotState();
    }, 30000);
    return () => clearInterval(t);
  }, [accountId]);

  const handleStartBot = async () => {
    if (!accountId || !onStartBot) return;
    setBotActionLoading(true);
    try {
      await onStartBot();
      await fetchBotState();
    } catch (e) {
      console.error('Start bot failed:', e);
      alert(e instanceof Error ? e.message : 'Failed to start bot');
    } finally {
      setBotActionLoading(false);
    }
  };

  const handleStopBot = async () => {
    if (!accountId || !onStopBot) return;
    setBotActionLoading(true);
    try {
      await onStopBot();
      await fetchBotState();
    } catch (e) {
      console.error('Stop bot failed:', e);
      alert(e instanceof Error ? e.message : 'Failed to stop bot');
    } finally {
      setBotActionLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#181818] border border-zinc-800 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-base font-bold text-zinc-200 uppercase tracking-tight">BOT STATUS</h2>
        <button
          onClick={() => setIsConfigModalOpen(true)}
          className="hover:opacity-80 transition-opacity cursor-pointer"
        >
          <Settings size={20} className="text-zinc-400" />
        </button>
      </div>

      <div className="flex-1 space-y-4 mb-6">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">ACCOUNT</span>
          <span className="text-sm font-bold text-zinc-200">{botStatus.account_name}</span>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">TYPE</span>
          <span className="text-sm font-bold text-emerald-400">{botStatus.account_type_display}</span>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">ACTIVE BOT</span>
          <span className="text-sm font-bold text-[#86c7f3]">{botStatus.bot_name}</span>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">API</span>
          <div className="flex flex-col items-end">
            <span className={`text-sm font-bold ${botStatus.api_status === 'CONNECTED' ? 'text-emerald-400' : statusErrorClass}`}>
              {botStatus.api_status}
            </span>
            {botStatus.api_error && botStatus.api_status === 'DISCONNECTED' && (
              <span className={`text-[9px] ${statusErrorMutedClass} mt-0.5`} title={botStatus.api_error}>
                {botStatus.api_error.length > 20 ? botStatus.api_error.substring(0, 20) + '...' : botStatus.api_error}
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">STRATEGY</span>
          <span className="text-sm font-bold text-zinc-300">{botStatus.strategy_name}</span>
        </div>
      </div>

      <div className="flex gap-3">
        {isRunning ? (
          <button
            onClick={handleStopBot}
            disabled={!accountId || botActionLoading}
            className={stopClasses}
            style={stopColor ? { backgroundColor: stopColor } : undefined}
          >
            <div className="flex items-center justify-center gap-2">
              {botActionLoading ? '…' : 'STOP BOT'}
            </div>
          </button>
        ) : (
          <button
            onClick={handleStartBot}
            disabled={!accountId || botActionLoading}
            className="flex-1 bg-[#86c7f3] hover:bg-[#6bb0e8] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-widest py-3 px-4 rounded-xl transition-colors"
          >
            <div className="flex items-center justify-center gap-2">
              <Play size={14} />
              {botActionLoading ? '…' : 'START BOT'}
            </div>
          </button>
        )}
        <button
          onClick={onViewLogs || (() => alert('Please select an account first'))}
          disabled={!accountId}
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-200 font-bold text-xs uppercase tracking-widest py-3 px-4 rounded-xl transition-colors"
        >
          <FileText size={14} />
        </button>
      </div>

      {/* Configure Agent Modal */}
      <ConfigureAgentModal
        accountId={accountId}
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        onSave={() => {
          fetchBotStatus();
        }}
      />
    </div>
  );
};

export default BotTile;
