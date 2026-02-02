import React, { useState, useEffect } from 'react';
import { 
  Wallet, 
  Plus, 
  Key, 
  Trash2, 
  ExternalLink, 
  X, 
  Info,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import MoneyBagIcon from './MoneyBagIcon';
import { Account, AccountType } from '../types';

const Settings: React.FC = () => {
  // Initialize state from database (no localStorage)
  const [paperAccounts, setPaperAccounts] = useState<Account[]>([]);
  const [liveAccounts, setLiveAccounts] = useState<Account[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<AccountType>('Paper');
  
  // Form State
  const [newAccountName, setNewAccountName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [newSecretKey, setNewSecretKey] = useState('');

  // Load accounts from database on mount and when accounts change
  const loadAccounts = async () => {
    try {
      const res = await fetch('/api/accounts');
      if (res.ok) {
        const dbAccounts = await res.json();
        if (Array.isArray(dbAccounts)) {
          // Transform database accounts to match Account interface
          const transformedAccounts: Account[] = dbAccounts.map((acc: any) => ({
            id: acc.id,
            name: acc.name,
            type: acc.type as AccountType,
            apiKey: '***', // Masked for security (actual keys encrypted in DB)
            status: 'Connected', // Will be checked by bot-status API
            createdAt: acc.created_at ? new Date(acc.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
          }));

          const paper = transformedAccounts.filter(a => a.type === 'Paper');
          const live = transformedAccounts.filter(a => a.type === 'Live');

          setPaperAccounts(paper);
          setLiveAccounts(live);
        }
      }
    } catch (error) {
      console.error('Failed to load accounts from database:', error);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const openAddModal = (type: AccountType) => {
    setModalType(type);
    setIsModalOpen(true);
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newAccountName || !newApiKey || !newSecretKey) {
      alert('Please fill in all fields');
      return;
    }

    const accountId = `${modalType.toLowerCase()}-${Date.now()}`;
    
    try {
      // Save to database first
      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: accountId,
          name: newAccountName,
          type: modalType,
          api_key: newApiKey,
          secret_key: newSecretKey,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to save account to database');
      }

      // Reload accounts from database
      await loadAccounts();

      // Reset and close
      setNewAccountName('');
      setNewApiKey('');
      setNewSecretKey('');
      setIsModalOpen(false);
    } catch (error) {
      console.error('Failed to add account:', error);
      alert(error instanceof Error ? error.message : 'Failed to add account. Please try again.');
    }
  };

  const deleteAccount = async (id: string, type: AccountType) => {
    if (!confirm(`Are you sure you want to delete this ${type} account?`)) {
      return;
    }

    try {
      // Delete from database
      const response = await fetch(`/api/accounts?id=${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to delete account from database');
      }

      // Reload accounts from database
      await loadAccounts();
    } catch (error) {
      console.error('Failed to delete account:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete account. Please try again.');
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
          icon={<Wallet className="text-sky-400" size={20} />}
        />

        {/* Live Trading Accounts */}
        <AccountSection 
          title="Live Trading Accounts" 
          description="Production accounts with real capital deployment."
          accounts={liveAccounts}
          type="Live"
          onAdd={() => openAddModal('Live')}
          onDelete={(id) => deleteAccount(id, 'Live')}
          icon={<MoneyBagIcon className="text-[#B99DEB]" size={20} />}
        />

        {/* Global API Limits / Info */}
        <div className="bg-[#181818] border border-zinc-800 rounded-2xl p-6 shadow-sm flex items-start gap-4">
          <div className="p-3 bg-zinc-800/50 rounded-xl text-zinc-400">
            <Info size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-zinc-200">API Connectivity Notice</h3>
            <p className="text-xs text-zinc-500 leading-relaxed max-w-2xl">
              All accounts use the Alpaca Markets API. API keys are encrypted using AES-256-GCM and stored securely in your Postgres database. Accounts are accessible from any device connected to your database.
            </p>
          </div>
        </div>
      </div>

      {/* Add Account Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#181818] border border-zinc-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="bg-[#171717] px-6 py-4 flex items-center justify-between border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-lg ${modalType === 'Paper' ? 'bg-sky-500/10 text-sky-400' : 'bg-[#B99DEB]/10 text-[#B99DEB]'}`}>
                  {modalType === 'Paper' ? <Wallet size={18} /> : <MoneyBagIcon size={18} />}
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
                      : 'bg-[#B99DEB] text-white hover:opacity-90 shadow-[#B99DEB]/10'
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
  onDelete: (id: string, type: AccountType) => void;
  icon: React.ReactNode;
}

const AccountSection: React.FC<SectionProps> = ({ title, description, accounts, type, onAdd, onDelete, icon }) => {
  return (
    <div className="bg-[#181818] border border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
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
              {type === 'Paper' ? <Wallet size={32} /> : <MoneyBagIcon size={32} />}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-zinc-300">No {type} Accounts Connected</p>
              <p className="text-xs text-zinc-600 max-w-xs mx-auto">Add your Alpaca API credentials to start training or trading with real-time data.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accounts.map(acc => (
              <div key={acc.id} className="group bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-5 hover:border-zinc-700 transition-all">
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
                    <code className="text-[10px] font-mono font-bold tracking-widest">{acc.apiKey || '***'}</code>
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