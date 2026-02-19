import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { ModernMessageInput } from './ModernMessageInput';
import { useChat } from '@/hooks/useChat';
import { useChatStore } from '@/stores/chatStore';
import { Bot, User, Sparkles, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  images?: string[];
}

export const ModernChatWindow: React.FC = () => {
  const {
    messages: storeMessages,
    isStreaming,
    isLoading,
    streamingContent,
    sendMessage,
  } = useChat();
  
  const [localMessages, setLocalMessages] = React.useState<LocalMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sync local messages with store messages
  useEffect(() => {
    const converted = storeMessages.map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      timestamp: new Date(m.timestamp),
      images: m.images,
    }));
    setLocalMessages(converted);
  }, [storeMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [localMessages, streamingContent]);

  const setWasStopped = useChatStore((state) => state.setWasStopped);

  const handleSendMessage = async (text: string, images: string[]) => {
    // Reset wasStopped flag at the start of a new send operation
    setWasStopped(false);
    
    const newMessage: LocalMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
      images: images.length > 0 ? images : undefined
    };
    
    setLocalMessages(prev => [...prev, newMessage]);
    
    // Use sendMessage which automatically detects whether to use continueChat (improve) or startChat
    await sendMessage(text, images.length > 0 ? images : []);
  };

  const isProcessing = isStreaming || isLoading;

  return (
    <div className="flex flex-col h-full bg-zinc-950 relative overflow-hidden">
      {/* Messages Area - takes most space */}
      <div className="flex-1 overflow-hidden min-h-0">
        <ScrollArea className="h-full px-4" ref={scrollRef}>
          <div className="max-w-3xl mx-auto py-4 space-y-4">
            <AnimatePresence mode="popLayout">
              {localMessages.length === 0 && !streamingContent && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-8 text-center"
                >
                  <Sparkles className="w-6 h-6 text-blue-500 mb-2" />
                  <p className="text-zinc-400 text-sm">Start a conversation to activate agents</p>
                </motion.div>
              )}

              {localMessages.map((msg) => (
                <MessageItem key={msg.id} message={msg} />
              ))}

              {streamingContent && (
                <MessageItem 
                  message={{
                    id: 'streaming',
                    role: 'assistant',
                    content: streamingContent,
                    timestamp: new Date()
                  }}
                  isStreaming
                />
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>
      </div>

      {/* Input Area - fixed at bottom */}
      <div className="border-t border-white/5 bg-zinc-950 p-3">
        <ModernMessageInput onSendMessage={handleSendMessage} isLoading={isProcessing} />
      </div>
    </div>
  );
};

const MessageItem: React.FC<{ message: LocalMessage; isStreaming?: boolean }> = ({ message, isStreaming }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex justify-center my-2"
      >
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-full px-4 py-1 flex items-center gap-2">
          <Info className="w-3 h-3 text-zinc-500" />
          <span className="text-[10px] text-zinc-500 font-medium">{message.content}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex gap-4 group",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div className={cn(
        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1",
        isUser ? "bg-zinc-800" : "bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.3)]"
      )}>
        {isUser ? <User className="w-4 h-4 text-zinc-400" /> : <Bot className="w-4 h-4 text-white" />}
      </div>

      <div className={cn(
        "flex flex-col gap-2 max-w-[85%]",
        isUser ? "items-end" : "items-start"
      )}>
        <div className={cn(
          "px-4 py-3 rounded-2xl text-sm leading-relaxed prose prose-invert prose-p:leading-relaxed prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-white/5",
          isUser 
            ? "bg-zinc-800 text-zinc-100 rounded-tr-none" 
            : "bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-none shadow-xl"
        )}>
          <ReactMarkdown>{message.content}</ReactMarkdown>
          {isStreaming && (
            <motion.span 
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="inline-block w-2 h-4 ml-1 bg-blue-500 translate-y-0.5"
            />
          )}
        </div>

        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {message.images.map((img, i) => (
              <img 
                key={i} 
                src={img} 
                alt="attachment" 
                className="w-32 h-32 object-cover rounded-xl border border-white/5 shadow-lg" 
              />
            ))}
          </div>
        )}

        <span className="text-[10px] text-zinc-600 font-medium px-1">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </motion.div>
  );
};
