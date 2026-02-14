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
      <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
            <Key className="w-6 h-6 text-blue-500" />
          </div>
          <DialogTitle className="text-2xl font-bold text-center">Gemini API Key</DialogTitle>
          <DialogDescription className="text-zinc-400 text-center">
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
              className="bg-zinc-800 border-zinc-700 text-zinc-100 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <DialogFooter className="sm:justify-center">
            <Button 
              type="submit" 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium"
              disabled={!key.trim()}
            >
              <ShieldCheck className="w-4 h-4 mr-2" />
              Save and Continue
            </Button>
          </DialogFooter>
        </form>
        
        <div className="text-xs text-center text-zinc-500 mt-2">
          Don't have a key? Get one from the <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Google AI Studio</a>.
        </div>
      </DialogContent>
    </Dialog>
  );
};
