import React, { useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';
import { LayoutDashboard, Stethoscope, Brain, FileSearch, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

export const ConversationPanel: React.FC = () => {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isLoading = useChatStore((s) => s.isLoading);
  const waitingForHumanReply = useChatStore((s) => s.waitingForHumanReply);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);

  const showThinking = (isStreaming || isLoading) && messages.length > 0 && !waitingForHumanReply;
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
      className="flex-1 overflow-y-auto custom-scrollbar bg-background"
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

const EmptyState: React.FC = () => {
  const suggestions = [
    { icon: Stethoscope, text: 'Analyze medical imaging' },
    { icon: FileSearch, text: 'Search clinical literature' },
    { icon: Brain, text: 'Draft clinical reports' },
    { icon: Globe, text: 'Find treatment guidelines' },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center select-none">
      {/* Logo */}
      <div className="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center mb-6 shadow-glow">
        <LayoutDashboard className="w-8 h-8 text-accent-foreground" />
      </div>

      {/* Title */}
      <h1 className="text-2xl font-semibold text-foreground mb-2 tracking-tight">
        MedCrew
      </h1>

      {/* Subtitle */}
      <p className="text-sm text-foreground-muted max-w-md leading-relaxed">
        Your AI-powered multi-agent medical assistant. Ask a question, request a task,
        or upload an image to get started.
      </p>

      {/* Warning badge */}
      <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning-light border border-warning/20 text-warning text-xs font-medium">
        <span>Research & Demo Only</span>
      </div>

      {/* Suggestion chips */}
      <div className="mt-8 flex flex-wrap justify-center gap-2 max-w-lg">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.text}
            onClick={() => useChatStore.getState().setPendingInput(suggestion.text)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl",
              "bg-card border border-card-border",
              "text-sm text-foreground-secondary",
              "hover:border-accent hover:text-accent hover:bg-accent-light/50",
              "transition-all duration-200 cursor-pointer"
            )}
          >
            <suggestion.icon className="w-4 h-4" />
            {suggestion.text}
          </button>
        ))}
      </div>
    </div>
  );
};