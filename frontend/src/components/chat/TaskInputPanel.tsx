import { Button } from '@/components/ui/button';
import { useChat } from '@/hooks/useChat';
import { cn } from '@/lib/utils';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { useChatStore } from '@/stores/chatStore';
import { AnimatePresence, motion } from 'framer-motion';
import { Paperclip, PauseCircle, Send, X } from 'lucide-react';
import React, { useRef, useState } from 'react';

export const TaskInputPanel: React.FC = () => {
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { sendMessage, stopChat, isLoading, isStreaming } = useChat();
  const { geminiApiKey, backendHasApiKey } = useApiConfigStore();
  const wasStopped = useChatStore((state) => state.wasStopped);
  
  const isProcessing = (isStreaming || isLoading) && !wasStopped;

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

  const handleSend = async () => {
    console.log('Send clicked! Message:', message, 'Processing:', isProcessing, 'API Key exists:', !!geminiApiKey);
    if ((message.trim() || images.length > 0) && !isProcessing) {
      try {
        console.log('Sending message:', message);
        
        // Check if API key is configured (frontend or backend)
        if (!geminiApiKey && !backendHasApiKey) {
          console.error('No API key configured!');
          alert('Please enter your Gemini API key in the settings, or configure it in the backend .env file.');
          return;
        }
        
        // Use sendMessage which automatically detects whether to use improve or start new chat
        // If no frontend key, send empty string — backend will use its .env default
        await sendMessage(message, images, {
          model_platform: "GEMINI",
          model_type: "GEMINI_3_FLASH",
          api_key: geminiApiKey || "",
          api_url: null,
          language: "en",
          browser_port: 9222,
          max_retries: 3,
          allow_local_system: false,
          installed_mcp: { mcpServers: {} },
          bun_mirror: "",
          uvx_mirror: "",
          env_path: null,
          summary_prompt: "",
          extra_params: null,
          search_config: null
        });
        
        console.log('Message sent successfully');
        
        // Only clear message and images if the chat wasn't stopped by the user
        if (!wasStopped) {
          setMessage('');
          setImages([]);
        }
      } catch (error) {
        console.error('Failed to send:', error);
        if (error instanceof Error) {
          alert('Error: ' + error.message);
        }
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col bg-zinc-950">
      {/* Attached Images */}
      <AnimatePresence>
        {images.length > 0 && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex flex-wrap gap-2 px-4 pt-3"
          >
            {images.map((img, i) => (
              <div key={i} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-white/10">
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

      {/* Input Area */}
      <div className="flex-1 flex items-center gap-3 p-4">
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
          className="w-10 h-10 text-zinc-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-xl shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          <Paperclip className="w-5 h-5" />
        </Button>

        <div className="flex-1 relative">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your task or question..."
            // disabled={isProcessing}
            className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>

        {isStreaming ? (
          <Button
            size="icon"
            onClick={stopChat}
            className="w-10 h-10 rounded-xl transition-all duration-300 shrink-0 bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(220,38,38,0.4)]"
          >
            <PauseCircle className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            disabled={(!message.trim() && images.length === 0) || isLoading}
            onClick={() => {
              console.log('Button clicked directly');
              handleSend();
            }}
            className={cn(
              "w-10 h-10 rounded-xl transition-all duration-300 shrink-0",
              message.trim() || images.length > 0
                ? "bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]"
                : "bg-zinc-800 text-zinc-500"
            )}
          >
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Status Bar */}
      <div className="px-4 pb-3 flex items-center justify-center gap-4 text-[10px] text-zinc-600 font-medium uppercase tracking-widest">
        <span>Gemini 3 Flash</span>
        <span className="w-1 h-1 rounded-full bg-zinc-800" />
        <span>Multi-Agent System</span>
        <span className="w-1 h-1 rounded-full bg-zinc-800" />
        <span>Encrypted</span>
      </div>
    </div>
  );
};
