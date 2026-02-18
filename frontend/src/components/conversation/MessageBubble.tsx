import React from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from '@/types';
import { Bot, User, Info, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const { role, content } = message;

  // System messages render as centered info pills
  if (role === 'system') {
    return <SystemMessage content={content} />;
  }

  const isUser = role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={cn(
        'flex gap-3 py-4',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
          isUser
            ? 'bg-zinc-800 border border-zinc-700/50'
            : 'bg-gradient-to-br from-blue-500 to-blue-700 shadow-[0_0_12px_rgba(37,99,235,0.25)]'
        )}
      >
        {isUser ? (
          <User className="w-4 h-4 text-zinc-300" />
        ) : (
          <Bot className="w-4 h-4 text-white" />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex flex-col gap-1.5 min-w-0 max-w-[85%]',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {/* Role label */}
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-wider px-0.5',
            isUser ? 'text-zinc-500' : 'text-blue-400/70'
          )}
        >
          {isUser ? 'You' : 'MedGemma'}
        </span>

        {/* Message bubble */}
        {isUser ? (
          <div className="bg-zinc-800/80 border border-zinc-700/30 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-zinc-100 leading-relaxed">
            <p className="whitespace-pre-wrap break-words">{content}</p>
          </div>
        ) : (
          <div
            className={cn(
              'prose prose-invert prose-sm max-w-none',
              // Paragraph & text
              'prose-p:leading-relaxed prose-p:my-2',
              // Code blocks
              'prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl',
              'prose-code:text-blue-300 prose-code:before:content-[""] prose-code:after:content-[""]',
              // Headings
              'prose-headings:text-zinc-100 prose-headings:font-semibold',
              // Links
              'prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline',
              // Lists
              'prose-strong:text-zinc-200 prose-li:text-zinc-300',
              'prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5',
              // Quotes & dividers
              'prose-blockquote:border-blue-500/30 prose-blockquote:text-zinc-400',
              'prose-hr:border-zinc-800'
            )}
          >
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}

        {/* Timestamp */}
        <span className="text-[10px] text-zinc-600 font-medium px-0.5">
          {formatTimestamp(message.timestamp)}
        </span>
      </div>
    </motion.div>
  );
};

/**
 * System messages render as centered subtle pills.
 */
const SystemMessage: React.FC<{ content: string }> = ({ content }) => {
  const isFileEvent = content.startsWith('File created');

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-center py-2"
    >
      <div className="inline-flex items-center gap-2 bg-zinc-900/60 border border-zinc-800/40 rounded-full px-3.5 py-1.5 max-w-[85%]">
        {isFileEvent ? (
          <FileText className="w-3 h-3 text-emerald-500 shrink-0" />
        ) : (
          <Info className="w-3 h-3 text-zinc-500 shrink-0" />
        )}
        <span className="text-[11px] text-zinc-500 leading-tight truncate">
          {content}
        </span>
      </div>
    </motion.div>
  );
};

function formatTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
