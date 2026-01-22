import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Activity, 
  Plus, 
  Key, 
  Trash2, 
  ExternalLink, 
  X, 
  Info,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { Account, AccountType } from '../types';

// STORAGE KEYS for persistence
const STORAGE_KEY_PAPER = 'sortino_paper_accounts';
const STORAGE_KEY_LIVE = 'sortino_live_accounts';

const Settings: React.FC = () => {
  // Initialize state from LocalStorage if available, otherwise default to empty array
  const [paperAccounts, setPaperAccounts] = useState<Account[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_PAPER);
    return saved ? JSON.parse(saved) : [];
  });

  const [liveAccounts, setLiveAccounts] = useState<Account[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_LIVE);
    return saved ? JSON.parse(saved) : [];
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<AccountType>('Paper');
  
  // Form State
  const [newAccountName, setNewAccountName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [newSecretKey, setNewSecretKey] = useState('');

  // Save to LocalStorage whenever accounts change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PAPER, JSON.stringify(paperAccounts));
  }, [paperAccounts]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_LIVE, JSON.stringify(liveAccounts));
  }, [liveAccounts]);

  const openAddModal = (type: AccountType) => {
    setModalType(type);
    setIsModalOpen(true);
  };

  const handleAddAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const newAccount: Account = {
      id: `${modalType.toLowerCase()}-${Date.now()}`,
      name: newAccountName,
      type: modalType,
      // We store the masked key for display, but in a real app you'd send the full key to your backend
      apiKey: `${newApiKey.substring(0, 4)}...${newApiKey.substring(newApiKey.length - 4)}`,
      status: 'Connected', // Assume connected for now
      createdAt: new Date().toISOString().split('T')[0]
    };

    if (modalType === 'Paper') {
      setPaperAccounts([...paperAccounts, newAccount]);
    } else {
      setLiveAccounts([...liveAccounts, newAccount]);
    }

    // Reset and close
    setNewAccountName('');
    setNewApiKey('');
    setNewSecretKey('');
    setIsModalOpen(false);
  };

  const deleteAccount = (id: string, type: AccountType) => {
    if (type === 'Paper') {
      setPaperAccounts(paperAccounts.filter(a => a.id !== id));
    } else {
      setLiveAccounts(liveAccounts.filter(a => a.id !== id));
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">System Settings</h1>
        <p className="text-zinc-500 text-sm font-medium">Manage your broker integrations and security credentials.</p>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Paper Trading Accounts */}
        <AccountSection 
          title="Paper Trading Accounts" 
          description="Simulated environments for risk-free testing."
          accounts={paperAccounts}
          type="Paper"
          onAdd={() => openAddModal('Paper')}
          onDelete={(id) => deleteAccount(id, 'Paper')}
          icon={<ShieldCheck className="text-sky-400" size={20} />}
        />

        {/* Live Trading Accounts */}
        <AccountSection 
          title="Live Trading Accounts" 
          description="Production accounts with real capital deployment."
          accounts={liveAccounts}
          type="Live"
          onAdd={() => openAddModal('Live')}
          onDelete={(id) => deleteAccount(id, 'Live')}
          icon={<Activity className="text-rose-400" size={20} />}
        />

        {/* Global API Limits / Info */}
        <div className="bg-[#121212] border border-zinc-800 rounded-2xl p-6 shadow-sm flex items-start gap-4">
          <div className="p-3 bg-zinc-800/50 rounded-xl text-zinc-400">
            <Info size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-zinc-200">API Connectivity Notice</h3>
            <p className="text-xs text-zinc-500 leading-relaxed max-w-2xl">
              All accounts use the Alpaca Markets API. Keys are currently stored locally in your browser for demonstration purposes. In a production environment, these would be encrypted and stored in your Postgres database.
            </p>
          </div>
        </div>
      </div>

      {/* Add Account Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#121212] border border-zinc-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="bg-[#171717] px-6 py-4 flex items-center justify-between border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-lg ${modalType === 'Paper' ? 'bg-sky-500/10 text-sky-400' : 'bg-rose-500/10 text-rose-400'}`}>
                  {modalType === 'Paper' ? <ShieldCheck size={18} /> : <Activity size={18} />}
                </div>
                <span className="text-xs font-bold text-zinc-200 tracking-widest uppercase">Add {modalType} Alpaca Account</span>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleAddAccount} className="p-6 space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block px-1">Friendly Name</label>
                <input 
                  required
                  type="text" 
                  placeholder="e.g. Primary Alpha Strategy" 
                  className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-sky-400 transition-all placeholder:text-zinc-700"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block px-1">Alpaca API Key ID</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                  <input 
                    required
                    type="text" 
                    placeholder="PK..." 
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-11 pr-4 text-sm text-white focus:outline-none focus:border-sky-400 transition-all placeholder:text-zinc-700"
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block px-1">Alpaca Secret Key</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                  <input 
                    required
                    type="password" 
                    placeholder="••••••••••••••••" 
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-11 pr-4 text-sm text-white focus:outline-none focus:border-sky-400 transition-all placeholder:text-zinc-700"
                    value={newSecretKey}
                    onChange={(e) => setNewSecretKey(e.target.value)}
                  />
                </div>
              </div>

              <div className="pt-2">
                <button 
                  type="submit" 
                  className={`w-full py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-lg ${
                    modalType === 'Paper' 
                      ? 'bg-sky-400 text-black hover:bg-sky-300 shadow-sky-400/10' 
                      : 'bg-rose-500 text-white hover:bg-rose-400 shadow-rose-500/10'
                  }`}
                >
                  Connect Alpaca Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

interface SectionProps {
  title: string;
  description: string;
  accounts: Account[];
  type: AccountType;
  onAdd: () => void;
  onDelete: (id: string) => void;
  icon: React.ReactNode;
}

const AccountSection: React.FC<SectionProps> = ({ title, description, accounts, type, onAdd, onDelete, icon }) => {
  return (
    <div className="bg-[#121212] border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-6 py-5 border-b border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#171717]/30">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {icon}
            <h2 className="text-lg font-bold text-zinc-200 tracking-tight">{title}</h2>
          </div>
          <p className="text-xs text-zinc-500 font-medium">{description}</p>
        </div>
        <button 
          onClick={onAdd}
          className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest text-zinc-200 border border-zinc-700 transition-all group"
        >
          <Plus size={16} className="text-sky-400 group-hover:scale-110 transition-transform" />
          Add Alpaca Account
        </button>
      </div>
      
      <div className="p-6">
        {accounts.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-4 border-2 border-dashed border-zinc-800 rounded-2xl">
            <div className="p-4 bg-zinc-900/50 rounded-full text-zinc-600">
              {type === 'Paper' ? <ShieldCheck size={32} /> : <Activity size={32} />}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-zinc-300">No {type} Accounts Connected</p>
              <p className="text-xs text-zinc-600 max-w-xs mx-auto">Add your Alpaca API credentials to start training or trading with real-time data.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accounts.map(acc => (
              <div key={acc.id} className="group bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 hover:border-zinc-700 transition-all">
                <div className="flex justify-between items-start mb-4">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-zinc-100">{acc.name}</h4>
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-600">
                      <span>ID: {acc.id.split('-').slice(-1)}</span>
                      <span className="text-zinc-800">•</span>
                      <span>Added {acc.createdAt}</span>
                    </div>
                  </div>
                  <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                    acc.status === 'Connected' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                  }`}>
                    {acc.status === 'Connected' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                    {acc.status}
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-4 border-t border-zinc-800/50">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Key size={12} />
                    <code className="text-[10px] font-mono font-bold tracking-widest">{acc.apiKey}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="p-2 text-zinc-500 hover:text-zinc-200 transition-colors" title="External Dashboard">
                      <ExternalLink size={14} />
                    </button>
                    <button 
                      onClick={() => onDelete(acc.id, acc.type)}
                      className="p-2 text-zinc-600 hover:text-rose-500 transition-colors" 
                      title="Remove Account"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;