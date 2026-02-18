import React, { useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';
import { Sparkles } from 'lucide-react';

export const ConversationPanel: React.FC = () => {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isLoading = useChatStore((s) => s.isLoading);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);

  const showThinking = (isStreaming || isLoading) && messages.length > 0;
  const isEmpty = messages.length === 0 && !isLoading;

  // Track if user has scrolled up (to avoid fighting their scroll position)
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isUserScrolledUp.current = distanceFromBottom > 100;
  }, []);

  // Auto-scroll to bottom on new messages (unless user scrolled up)
  useEffect(() => {
    if (!isUserScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isStreaming]);

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto custom-scrollbar"
    >
      <div className="max-w-3xl mx-auto px-6 py-6">
        {isEmpty ? (
          <EmptyState />
        ) : (
          <div className="space-y-0">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {showThinking && <ThinkingIndicator />}

            <div ref={messagesEndRef} className="h-1" />
          </div>
        )}
      </div>
    </div>
  );
};

const EmptyState: React.FC = () => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] text-center select-none">
    {/* Logo */}
    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(37,99,235,0.2)]">
      <Sparkles className="w-8 h-8 text-white" />
    </div>

    {/* Title */}
    <h1 className="text-2xl font-semibold text-zinc-100 mb-2 tracking-tight">
      MedGemma
    </h1>

    {/* Subtitle */}
    <p className="text-sm text-zinc-500 max-w-md leading-relaxed">
      Your AI-powered multi-agent assistant. Ask a question, request a task,
      or upload an image to get started.
    </p>

    {/* Suggestion chips */}
    <div className="mt-8 flex flex-wrap justify-center gap-2">
      {[
        'Search medical literature',
        'Write a clinical report',
        'Analyze patient data',
        'Create a presentation',
      ].map((suggestion) => (
        <div
          key={suggestion}
          className="px-3.5 py-2 rounded-xl bg-zinc-900/80 border border-zinc-800/60 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-300 transition-colors cursor-default"
        >
          {suggestion}
        </div>
      ))}
    </div>
  </div>
);
