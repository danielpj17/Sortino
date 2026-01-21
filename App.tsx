
import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  History, 
  Activity, 
  TrendingUp, 
  Settings as SettingsIcon, 
  Menu, 
  ChevronRight,
  Cpu
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import TradeHistory from './components/TradeHistory';
import LiveTrading from './components/LiveTrading';
import PaperTrading from './components/PaperTrading';
import Settings from './components/Settings';

const App: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  return (
    <Router>
      <div className="flex h-screen overflow-hidden bg-[#0d0d0d] text-zinc-100">
        {/* Sidebar */}
        <aside className={`${isSidebarOpen ? 'w-64' : 'w-20'} transition-all duration-300 bg-[#121212] border-r border-zinc-800/50 flex flex-col`}>
          <div className="p-6 flex items-center justify-between">
            <div className={`flex items-center gap-3 ${!isSidebarOpen && 'hidden'}`}>
              <div className="bg-[#86c7f3] p-2 rounded-lg shadow-lg shadow-[#86c7f3]/20">
                <TrendingUp size={24} className="text-black" />
              </div>
              <span className="font-bold text-xl tracking-tight">Sortino</span>
            </div>
            <button 
              onClick={() => setSidebarOpen(!isSidebarOpen)}
              className="p-1 hover:bg-zinc-800 rounded-md text-zinc-500 transition-colors"
              aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              <Menu size={20} />
            </button>
          </div>

          <nav className="flex-1 px-4 py-4 space-y-1">
            <SidebarItem icon={<LayoutDashboard size={20} />} label="Dashboard" to="/" collapsed={!isSidebarOpen} />
            <SidebarItem icon={<Cpu size={20} />} label="Paper Trading" to="/paper" collapsed={!isSidebarOpen} />
            <SidebarItem icon={<Activity size={20} />} label="Live Trading" to="/live" collapsed={!isSidebarOpen} />
            <SidebarItem icon={<History size={20} />} label="History" to="/history" collapsed={!isSidebarOpen} />
          </nav>

          <div className="p-4 border-t border-zinc-800">
            <SidebarItem icon={<SettingsIcon size={20} />} label="Settings" to="/settings" collapsed={!isSidebarOpen} />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-[#0d0d0d] p-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/paper" element={<PaperTrading />} />
            <Route path="/live" element={<LiveTrading />} />
            <Route path="/history" element={<TradeHistory />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
};

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  to: string;
  collapsed: boolean;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ icon, label, to, collapsed }) => {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link 
      to={to}
      className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 ${
        isActive 
          ? 'bg-zinc-800/50 text-[#86c7f3] border border-zinc-700/50 shadow-sm shadow-[#86c7f3]/10' 
          : 'text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-200'
      }`}
    >
      <div className={isActive ? 'text-[#86c7f3]' : ''}>{icon}</div>
      {!collapsed && <span className="font-medium text-sm">{label}</span>}
      {!collapsed && isActive && <ChevronRight size={14} className="ml-auto" />}
    </Link>
  );
};

export default App;
