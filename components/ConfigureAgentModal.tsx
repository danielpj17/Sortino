import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ConfigureAgentModalProps {
  accountId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

const ConfigureAgentModal: React.FC<ConfigureAgentModalProps> = ({
  accountId,
  isOpen,
  onClose,
  onSave
}) => {
  const [capitalType, setCapitalType] = useState<'CASH' | 'MARGIN'>('CASH');
  const [allowShorting, setAllowShorting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Fetch current settings when modal opens
  useEffect(() => {
    if (isOpen) {
      const fetchSettings = async () => {
        try {
          const url = accountId ? `/api/bot-status?account_id=${accountId}` : '/api/bot-status';
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            setCapitalType(data.account_type_display === 'MARGIN' ? 'MARGIN' : 'CASH');
            setAllowShorting(data.allow_shorting || false);
          }
        } catch (err) {
          console.error('Failed to fetch settings', err);
        }
      };
      fetchSettings();
    }
  }, [isOpen, accountId]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // If no account_id, get first account
      let targetAccountId = accountId;
      if (!targetAccountId) {
        const accountsRes = await fetch('/api/accounts');
        if (accountsRes.ok) {
          const accounts = await accountsRes.json();
          if (accounts.length > 0) {
            targetAccountId = accounts[0].id;
          }
        }
      }

      if (!targetAccountId) {
        setError('No account found to configure');
        setIsLoading(false);
        return;
      }

      const response = await fetch('/api/bot-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_id: targetAccountId,
          strategy_name: "Sortino's Model",
          account_type_display: capitalType,
          allow_shorting: capitalType === 'MARGIN' ? allowShorting : false
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save configuration');
      }

      onSave();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="bg-[#121212] border border-zinc-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#171717] px-6 py-4 flex items-center justify-between border-b border-zinc-800">
          <h2 className="text-base font-bold text-white uppercase tracking-tight">CONFIGURE AGENT</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="p-6 space-y-6">
          {/* Strategy Bot Section */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block">
              STRATEGY BOT
            </label>
            <button
              type="button"
              disabled
              className="w-full bg-zinc-800/50 border border-[#86c7f3] text-white text-sm font-bold py-3 px-4 rounded-xl cursor-not-allowed opacity-75"
            >
              Sortino's Model
            </button>
          </div>

          {/* Capital Configuration Section */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block">
              CAPITAL CONFIGURATION
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setCapitalType('CASH');
                  setAllowShorting(false);
                }}
                className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-colors ${
                  capitalType === 'CASH'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                Cash
              </button>
              <button
                type="button"
                onClick={() => setCapitalType('MARGIN')}
                className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-colors ${
                  capitalType === 'MARGIN'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                Margin
              </button>
            </div>

            {/* Allow Short Selling Toggle (only when Margin is selected) */}
            {capitalType === 'MARGIN' && (
              <div className="flex items-center justify-between pt-2">
                <label className="text-sm font-bold text-zinc-300">Allow Short Selling</label>
                <button
                  type="button"
                  onClick={() => setAllowShorting(!allowShorting)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    allowShorting ? 'bg-emerald-500' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      allowShorting ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/50 rounded-xl p-3 text-rose-400 text-sm">
              {error}
            </div>
          )}

          {/* Save Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#86c7f3] hover:bg-[#6bb0e8] text-white font-bold text-sm uppercase tracking-widest py-3 px-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'SAVING...' : 'SAVE CONFIGURATION'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ConfigureAgentModal;
