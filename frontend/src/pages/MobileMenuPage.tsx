import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUIStore } from '@/stores';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import {
  ArrowLeft,
  History,
  LayoutDashboard,
  Monitor,
  Moon,
  HelpCircle,
  Settings,
  Sun,
  PanelRightOpen,
} from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

export const MobileMenuPage: React.FC = () => {
  const navigate = useNavigate();
  const { theme, setTheme, resolvedTheme } = useUIStore();

  // Cycle through themes: light -> dark -> system
  const cycleTheme = () => {
    const themes: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setTheme(nextTheme);
  };

  const ThemeIcon = theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  const menuItems = [
    {
      icon: <LayoutDashboard className="w-5 h-5" />,
      label: 'Home',
      description: 'Return to dashboard',
      onClick: () => navigate('/'),
    },
    {
      icon: <History className="w-5 h-5" />,
      label: 'History',
      description: 'View conversation history',
      onClick: () => navigate('/'),
    },
    {
      icon: <PanelRightOpen className="w-5 h-5" />,
      label: 'Monitoring Panel',
      description: 'View task monitoring and agent activity',
      onClick: () => navigate('/?panel=open'),
    },
    {
      icon: <Settings className="w-5 h-5" />,
      label: 'Clear API Key',
      description: 'Reset your API configuration',
      onClick: () => {
        useApiConfigStore.getState().clearApiKey();
        navigate('/');
      },
    },
    {
      icon: <HelpCircle className="w-5 h-5" />,
      label: 'Help & Credits',
      description: 'View acknowledgments and help',
      onClick: () => navigate('/thank-you'),
    },
    {
      icon: <ThemeIcon className="w-5 h-5" />,
      label: `Theme: ${theme}`,
      description: 'Switch between light, dark, and system themes',
      onClick: () => {
        cycleTheme();
      },
    },
  ];

  return (
    <div className="h-screen w-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur-md flex items-center px-4 sticky top-0 z-50">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="mr-3"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center mr-3">
          <LayoutDashboard className="w-5 h-5 text-accent-foreground" />
        </div>
        <h1 className="text-lg font-semibold">MedCrew</h1>
      </header>

      {/* Menu Items - Scrollable */}
      <ScrollArea className="flex-1 h-[calc(100vh-56px)]">
        <main className="p-4">
          <div className="space-y-2">
            {menuItems.map((item, index) => (
              <button
                key={index}
                onClick={item.onClick}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-card hover:bg-accent/10 border border-border transition-colors text-left"
              >
                <div className="p-1.5 rounded-lg bg-background text-foreground-secondary shrink-0">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-foreground">{item.label}</h3>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    {item.description}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* System Status */}
          <div className="mt-8 p-4 rounded-xl bg-accent/10 border border-accent/20">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-success"></span>
              </span>
              <div>
                <p className="font-medium text-foreground">System Ready</p>
                <p className="text-sm text-foreground-muted">
                  All services operational
                </p>
              </div>
            </div>
          </div>
        </main>
      </ScrollArea>
    </div>
  );
};
