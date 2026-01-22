import React, { useState, useEffect } from 'react';
import { Settings, Play, FileText } from 'lucide-react';
import ConfigureAgentModal from './ConfigureAgentModal';

interface BotTileProps {
  accountId?: string | null;
  onStartBot?: () => void;
  onViewLogs?: () => void;
}

const BotTile: React.FC<BotTileProps> = ({ accountId, onStartBot, onViewLogs }) => {
  const [botStatus, setBotStatus] = useState({
    account_name: 'STANDARD STRATEGY',
    bot_name: 'ALPHA-01',
    account_type_display: 'CASH',
    strategy_name: "Sortino's Model",
    api_status: 'CONNECTED'
  });
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

  useEffect(() => {
    fetchBotStatus();
    const interval = setInterval(fetchBotStatus, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [accountId]);

  return (
    <div className="bg-[#121212] border border-zinc-800 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-base font-bold text-zinc-200 uppercase tracking-tight">BOT STATUS</h2>
        <button
          onClick={() => setIsConfigModalOpen(true)}
          className="hover:opacity-80 transition-opacity cursor-pointer"
        >
          <Settings size={20} className="text-zinc-400" />
        </button>
      </div>

      <div className="space-y-4 mb-6">
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
          <span className={`text-sm font-bold ${botStatus.api_status === 'CONNECTED' ? 'text-emerald-400' : 'text-rose-400'}`}>
            {botStatus.api_status}
          </span>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">STRATEGY</span>
          <span className="text-sm font-bold text-zinc-300">{botStatus.strategy_name}</span>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onStartBot}
          className="flex-1 bg-[#86c7f3] hover:bg-[#6bb0e8] text-white font-bold text-xs uppercase tracking-widest py-3 px-4 rounded-xl transition-colors"
        >
          <div className="flex items-center justify-center gap-2">
            <Play size={14} />
            START BOT
          </div>
        </button>
        <button
          onClick={onViewLogs}
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs uppercase tracking-widest py-3 px-4 rounded-xl transition-colors"
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
