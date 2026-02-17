import { useUIStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { Moon, Sun } from 'lucide-react';

export function Header() {
  const { theme, setTheme } = useUIStore();

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
  };

  return (
    <header className="h-16 border-b bg-card flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-4">
        {/* Menu button removed as per request */}
        <h1 className="text-xl font-bold text-foreground">
          MedGemma Team
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </Button>

        {/* User menu/Fullscreen removed as per request */}
      </div>
    </header>
  );
}
