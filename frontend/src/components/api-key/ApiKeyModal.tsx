import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { Key, ShieldCheck } from 'lucide-react';

export const ApiKeyModal: React.FC = () => {
  const { setApiKey, loadFromStorage, isModalOpen, setModalOpen } = useApiConfigStore();
  const [key, setKey] = useState('');

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim()) {
      setApiKey(key.trim());
    }
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={setModalOpen}>
      <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 bg-accent-light rounded-full flex items-center justify-center mb-4">
            <Key className="w-6 h-6 text-accent" />
          </div>
          <DialogTitle className="text-2xl font-bold text-center">Gemini API Key</DialogTitle>
          <DialogDescription className="text-foreground-muted text-center">
            Enter your Google Gemini API key to start using MedGemma.
            Your key is stored locally in your browser.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="Enter your API key..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="bg-input border-input-border text-foreground focus:ring-accent"
              autoFocus
            />
          </div>
          <DialogFooter className="sm:justify-center">
            <Button
              type="submit"
              className="w-full bg-accent hover:bg-accent-hover text-accent-foreground font-medium"
              disabled={!key.trim()}
            >
              <ShieldCheck className="w-4 h-4 mr-2" />
              Save and Continue
            </Button>
          </DialogFooter>
        </form>

        <div className="text-xs text-center text-foreground-muted mt-2">
          Don't have a key? Get one from the <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Google AI Studio</a>.
        </div>
      </DialogContent>
    </Dialog>
  );
};