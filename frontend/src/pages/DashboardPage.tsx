import React from 'react';
import { Link } from 'react-router-dom';
import { ApiKeyModal } from '@/components/api-key/ApiKeyModal';
import { TaskInputPanel } from '@/components/chat/TaskInputPanel';
import { TaskDecompositionPanel } from '@/components/task-panel/TaskDecompositionPanel';
import { BrowserSnapshots } from '@/components/resources/BrowserSnapshots';
import { ConversationPanel } from '@/components/conversation/ConversationPanel';
import { ErrorBanner } from '@/components/layout/ErrorBanner';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import {
  LayoutDashboard,
  Settings,
  History,
  HelpCircle,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

export const DashboardPage: React.FC = () => {
  const [rightSidebarOpen, setRightSidebarOpen] = React.useState(true);

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex overflow-hidden">
      <ApiKeyModal />

      {/* ─── Left Sidebar Navigation ─── */}
      <aside className="w-16 flex flex-col items-center py-6 border-r border-white/5 bg-black z-50 shrink-0">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center mb-10 shadow-[0_0_20px_rgba(37,99,235,0.3)]">
          <LayoutDashboard className="w-6 h-6 text-white" />
        </div>

        <div className="flex-1 flex flex-col gap-6">
          <NavIcon icon={<History className="w-5 h-5" />} active />
          <NavIcon
            icon={<Settings className="w-5 h-5" />}
            onClick={() => useApiConfigStore.getState().clearApiKey()}
          />
          <Link to="/thank-you">
            <NavIcon icon={<HelpCircle className="w-5 h-5" />} />
          </Link>
        </div>

        <div className="mt-auto" />
      </aside>

      {/* ─── Main Content Area ─── */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-white/5 bg-zinc-950/80 backdrop-blur-md flex items-center justify-between px-6 z-30 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-bold tracking-tight text-zinc-300">
              MEDGEMMA <span className="text-blue-500">v2.0</span>
            </h2>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                System Ready
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Right sidebar toggle */}
            <button
              onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
              className={cn(
                'p-2 rounded-lg transition-colors',
                rightSidebarOpen
                  ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                  : 'text-zinc-600 hover:text-zinc-400 hover:bg-white/5'
              )}
              title={
                rightSidebarOpen
                  ? 'Hide monitoring panel'
                  : 'Show monitoring panel'
              }
            >
              {rightSidebarOpen ? (
                <PanelRightClose className="w-4 h-4" />
              ) : (
                <PanelRightOpen className="w-4 h-4" />
              )}
            </button>
          </div>
        </header>

        {/* Error Banner */}
        <ErrorBanner />

        {/* ─── Main Layout: Conversation + Right Sidebar ─── */}
        <div className="flex-1 flex overflow-hidden">
          {/* Center: Conversation Panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Scrollable messages */}
            <ConversationPanel />

            {/* Input Panel - anchored at bottom */}
            <div className="border-t border-white/5 bg-zinc-950 shrink-0">
              <div className="max-w-3xl mx-auto">
                <TaskInputPanel />
              </div>
            </div>
          </div>

          {/* Right: Monitoring Sidebar */}
          <AnimatePresence mode="wait">
            {rightSidebarOpen && (
              <motion.aside
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 420, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="bg-zinc-950 border-l border-white/5 flex flex-col shrink-0 overflow-hidden"
              >
                <div className="w-[420px] flex flex-col h-full">
                  {/* Task Decomposition Map */}
                  <div className="flex-1 flex flex-col border-b border-white/5 overflow-hidden min-h-0">
                    <TaskDecompositionPanel />
                  </div>

                  {/* Browser Snapshots */}
                  <div className="h-[240px] overflow-hidden shrink-0">
                    <BrowserSnapshots />
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};

const NavIcon: React.FC<{
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}> = ({ icon, active, onClick }) => (
  <button
    onClick={onClick}
    className={cn(
      'p-3 rounded-xl transition-all duration-300 group',
      active
        ? 'bg-blue-600/10 text-blue-500'
        : 'text-zinc-600 hover:text-zinc-300 hover:bg-white/5'
    )}
  >
    {icon}
  </button>
);
