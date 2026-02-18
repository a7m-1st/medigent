import { Button } from '@/components/ui/button';
import { useChat } from '@/hooks/useChat';
import { cn } from '@/lib/utils';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { useChatStore } from '@/stores/chatStore';
import { AnimatePresence, motion } from 'framer-motion';
import { Paperclip, PauseCircle, Send, X, Image as ImageIcon } from 'lucide-react';
import React, { useRef, useState } from 'react';

export const TaskInputPanel: React.FC = () => {
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { sendMessage, stopChat, isLoading, isStreaming } = useChat();
  const { geminiApiKey, backendHasApiKey } = useApiConfigStore();
  const wasStopped = useChatStore((state) => state.wasStopped);

  const isProcessing = (isStreaming || isLoading) && !wasStopped;
  const hasContent = message.trim() || images.length > 0;

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
    <div className="flex flex-col bg-background">
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
              <motion.div
                key={i}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="relative group w-16 h-16 rounded-lg overflow-hidden border border-border bg-background-secondary"
              >
                <img src={img} alt="upload" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 p-1 bg-background/90 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                >
                  <X className="w-3 h-3 text-foreground" />
                </button>
              </motion.div>
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
          className={cn(
            "w-10 h-10 rounded-xl shrink-0 transition-colors",
            "text-foreground-muted hover:text-accent hover:bg-accent-light"
          )}
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          <Paperclip className="w-5 h-5" />
        </Button>

        <div
          className={cn(
            "flex-1 relative rounded-xl transition-all duration-200",
            isFocused && "ring-2 ring-accent/20"
          )}
        >
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Enter your task or question..."
            className={cn(
              "w-full bg-input border border-input-border rounded-xl px-4 py-3",
              "text-foreground placeholder:text-foreground-muted",
              "focus:outline-none focus:border-accent transition-colors",
              isProcessing && "opacity-60"
            )}
          />
        </div>

        {isStreaming ? (
          <Button
            size="icon"
            onClick={stopChat}
            className="w-10 h-10 rounded-xl transition-all duration-300 shrink-0 bg-error hover:bg-error/90 text-white shadow-glow-error"
          >
            <PauseCircle className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            disabled={!hasContent || isLoading}
            onClick={() => {
              console.log('Button clicked directly');
              handleSend();
            }}
            className={cn(
              "w-10 h-10 rounded-xl transition-all duration-300 shrink-0",
              hasContent
                ? "bg-accent hover:bg-accent-hover text-accent-foreground shadow-glow"
                : "bg-background-tertiary text-foreground-muted"
            )}
          >
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Status Bar */}
      <div className="px-4 pb-3 flex items-center justify-center gap-4 text-[10px] text-foreground-muted font-medium uppercase tracking-widest">
        <span>Gemini 3 Flash</span>
        <span className="w-1 h-1 rounded-full bg-border" />
        <span>Multi-Agent System</span>
        <span className="w-1 h-1 rounded-full bg-border" />
        <span>Encrypted</span>
      </div>
    </div>
  );
};