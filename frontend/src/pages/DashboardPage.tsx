import React from 'react';
import { Link } from 'react-router-dom';
import { ApiKeyModal } from '@/components/api-key/ApiKeyModal';
import { TaskInputPanel } from '@/components/chat/TaskInputPanel';
import { TaskDecompositionPanel } from '@/components/task-panel/TaskDecompositionPanel';
import { AgentDashboard } from '@/components/agents/AgentDashboard';
import { TerminalOutput } from '@/components/resources/TerminalOutput';
import { BrowserSnapshots } from '@/components/resources/BrowserSnapshots';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { 
  LayoutDashboard, 
  Settings, 
  History, 
  HelpCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const DashboardPage: React.FC = () => {

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex overflow-hidden">
      <ApiKeyModal />

      {/* Sidebar Navigation */}
      <aside className="w-16 flex flex-col items-center py-6 border-r border-white/5 bg-black z-50 shrink-0">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center mb-10 shadow-[0_0_20px_rgba(37,99,235,0.3)]">
          <LayoutDashboard className="w-6 h-6 text-white" />
        </div>
        
        <div className="flex-1 flex flex-col gap-6">
          <NavIcon icon={<History className="w-5 h-5" />} active />
          <NavIcon icon={<Settings className="w-5 h-5" />} onClick={() => useApiConfigStore.getState().clearApiKey()} />
          <Link to="/thank-you">
            <NavIcon icon={<HelpCircle className="w-5 h-5" />} />
          </Link>
        </div>

        <div className="mt-auto">
          {/* Bottom indicator or avatar could go here */}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Top Header */}
        <header className="h-14 border-b border-white/5 bg-zinc-950/50 backdrop-blur-md flex items-center justify-between px-6 z-30 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-bold tracking-tight text-zinc-300">MEDGEMMA <span className="text-blue-500">v2.0</span></h2>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">System Ready</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Action buttons removed as per request */}
          </div>
        </header>

        {/* Main Dashboard Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Agent Dashboard + Chat */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Top 70%: Agent Status Grid */}
            <div className="flex-[70] flex flex-col border-b border-white/5 overflow-hidden">
              <div className="flex-1 p-4 overflow-auto">
                <AgentDashboard />
              </div>
            </div>
            
            {/* Bottom: Task Input */}
            
            <div className="h-[120px] flex-shrink-0 border-t border-white/5 bg-zinc-950">
              
              <TaskInputPanel />
            </div>
          </div>

          {/* Right: Task Map + Resources */}
          <aside className="w-[500px] bg-zinc-950 border-l border-white/5 flex flex-col shrink-0">
            {/* Top: Task Decomposition Panel */}
            <div className="flex-1 flex flex-col border-b border-white/5 overflow-hidden">
              <TaskDecompositionPanel />
            </div>
            
            {/* Bottom: Resource Monitors (Terminal + Browser) */}
            <div className="h-1/2 flex flex-col">
              <div className="flex-1 border-b border-white/5 overflow-hidden">
                <TerminalOutput />
              </div>
              <div className="flex-1 overflow-hidden">
                <BrowserSnapshots />
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};

const NavIcon: React.FC<{ icon: React.ReactNode; active?: boolean; onClick?: () => void }> = ({ icon, active, onClick }) => (
  <button 
    onClick={onClick}
    className={cn(
      "p-3 rounded-xl transition-all duration-300 group",
      active 
        ? "bg-blue-600/10 text-blue-500" 
        : "text-zinc-600 hover:text-zinc-300 hover:bg-white/5"
    )}
  >
    {icon}
  </button>
);
