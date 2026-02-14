import React, { useState, useRef } from 'react';
import { Send, X, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ModernMessageInputProps {
  onSendMessage: (text: string, images: string[]) => void;
  isLoading: boolean;
}

export const ModernMessageInput: React.FC<ModernMessageInputProps> = ({ 
  onSendMessage, 
  isLoading 
}) => {
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setImages(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if ((message.trim() || images.length > 0) && !isLoading) {
      onSendMessage(message, images);
      setMessage('');
      setImages([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-4 pb-6 pt-2">
      <div className="relative bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl focus-within:border-blue-500/50 transition-all duration-300">
        <AnimatePresence>
          {images.length > 0 && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex flex-wrap gap-2 p-3 border-b border-zinc-800"
            >
              {images.map((img, i) => (
                <div key={i} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-white/10">
                  <img src={img} alt="upload" className="w-full h-full object-cover" />
                  <button 
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 p-1 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end gap-2 p-2">
          <div className="flex items-center gap-1 pb-1">
            <input 
              type="file" 
              accept="image/*" 
              multiple 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
            />
            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9 text-zinc-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-xl"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="w-5 h-5" />
            </Button>
          </div>

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your medical analysis or development task..."
            className="flex-1 min-h-[44px] max-h-48 bg-transparent border-0 focus-visible:ring-0 resize-none py-3 text-zinc-100 placeholder:text-zinc-500"
            rows={1}
          />

          <div className="flex items-center gap-1 pb-1">
            <Button
              size="icon"
              disabled={(!message.trim() && images.length === 0) || isLoading}
              onClick={handleSend}
              className={cn(
                "w-9 h-9 rounded-xl transition-all duration-300",
                message.trim() || images.length > 0
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]"
                  : "bg-zinc-800 text-zinc-500"
              )}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
      
      <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-zinc-600 font-medium uppercase tracking-widest">
        <span>Gemini 1.5 Pro</span>
        <span className="w-1 h-1 rounded-full bg-zinc-800" />
        <span>Multi-Agent System</span>
        <span className="w-1 h-1 rounded-full bg-zinc-800" />
        <span>Encrypted</span>
      </div>
    </div>
  );
};
