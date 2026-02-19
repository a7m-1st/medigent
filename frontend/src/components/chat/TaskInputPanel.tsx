import { Button } from '@/components/ui/button';
import { useChat } from '@/hooks/useChat';
import { cn } from '@/lib/utils';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { useChatStore } from '@/stores/chatStore';
import { AnimatePresence, motion } from 'framer-motion';
import { Paperclip, PauseCircle, Send, X, Upload } from 'lucide-react';
import React, { useRef, useState, useCallback, useEffect } from 'react';

export const TaskInputPanel: React.FC = () => {
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { sendMessage, stopChat, isLoading, isStreaming } = useChat();
  const { geminiApiKey, backendHasApiKey } = useApiConfigStore();
  const wasStopped = useChatStore((state) => state.wasStopped);
  const draftMessage = useChatStore((state) => state.draftMessage);
  const setDraftMessage = useChatStore((state) => state.setDraftMessage);

  const isProcessing = (isStreaming || isLoading) && !wasStopped;
  const hasContent = message.trim() || images.length > 0;
  const canSend = hasContent && !isProcessing;

  // Sync draft message from store to local state
  useEffect(() => {
    if (draftMessage) {
      setMessage(draftMessage);
      setDraftMessage(''); // Clear the draft in the store
      // Focus the input
      inputRef.current?.focus();
    }
  }, [draftMessage, setDraftMessage]);

  // Process files (from input or drag & drop)
  const processFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(file => {
      // Only accept image files
      if (!file.type.startsWith('image/')) {
        console.warn('Skipping non-image file:', file.name);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setImages(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      processFiles(files);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  // Drag & Drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isProcessing) return;
    setIsDragging(true);
  }, [isProcessing]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragging to false if we're leaving the drop zone entirely
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isProcessing) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
  }, [isProcessing, processFiles]);

  const handleSend = async () => {
    console.log('Send clicked! Message:', message, 'Processing:', isProcessing, 'API Key exists:', !!geminiApiKey);
    if ((message.trim() || images.length > 0) && !isProcessing) {
      // Check if API key is configured (frontend or backend)
      if (!geminiApiKey && !backendHasApiKey) {
        console.error('No API key configured!');
        alert('Please enter your Gemini API key in the settings, or configure it in the backend .env file.');
        return;
      }

      // Capture current values before clearing
      const currentMessage = message;
      const currentImages = [...images];

      // Clear input immediately for better UX
      setMessage('');
      setImages([]);

      // Add user message to chat immediately (with images)
      useChatStore.getState().addMessage({
        id: `user-${Date.now()}`,
        role: 'user',
        content: currentMessage,
        timestamp: new Date().toISOString(),
        images: currentImages.length > 0 ? currentImages : undefined,
      });

      try {
        console.log('Sending message:', currentMessage);

        // Use sendMessage which automatically detects whether to use improve or start new chat
        // If no frontend key, send empty string — backend will use its .env default
        await sendMessage(currentMessage, currentImages, {
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
      } catch (error) {
        console.error('Failed to send:', error);
        // Restore input on error so user can retry
        setMessage(currentMessage);
        setImages(currentImages);
        if (error instanceof Error) {
          alert('Error: ' + error.message);
        }
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Block Enter key when processing
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        handleSend();
      }
    }
  };

  return (
    <div
      ref={dropZoneRef}
      className={cn(
        "flex flex-col bg-background relative transition-colors",
        isDragging && "bg-accent/5"
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent rounded-xl m-2 pointer-events-none"
          >
            <div className="flex flex-col items-center gap-2 text-accent">
              <Upload className="w-8 h-8" />
              <span className="text-sm font-medium">Drop images here</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
            ref={inputRef}
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
            disabled={!canSend}
            onClick={() => {
              console.log('Button clicked directly');
              handleSend();
            }}
            className={cn(
              "w-10 h-10 rounded-xl transition-all duration-300 shrink-0",
              canSend
                ? "bg-accent hover:bg-accent-hover text-accent-foreground shadow-glow"
                : "bg-background-tertiary text-foreground-muted cursor-not-allowed"
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