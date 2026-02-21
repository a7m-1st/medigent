import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/types';
import { motion } from 'framer-motion';
import { Bot, CheckCircle2, FileText, Info, User } from 'lucide-react';
import React from 'react';
import ReactMarkdown from 'react-markdown';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const { role, content, images } = message;

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
            ? 'bg-accent text-accent-foreground'
            : 'bg-gradient-to-br from-teal-500 to-teal-700 shadow-glow-sm'
        )}
      >
        {isUser ? (
          <User className="w-4 h-4" />
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
            isUser ? 'text-foreground-muted' : 'text-teal-500 dark:text-teal-400'
          )}
        >
          {isUser ? 'You' : 'Health Unit Coordinator'}
        </span>

        {/* Message bubble */}
        {isUser ? (
          <div className="bg-user-bubble border border-user-bubble-border rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-foreground leading-relaxed shadow-sm">
            {/* Attached images */}
            {images && images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {images.map((img, idx) => (
                  <div
                    key={idx}
                    className="relative w-20 h-20 rounded-lg overflow-hidden border border-border bg-background-secondary"
                  >
                    <img
                      src={img}
                      alt={`Attachment ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
            <p className="whitespace-pre-wrap break-words">{content}</p>
          </div>
        ) : (
          <div className="bg-ai-bubble border border-ai-bubble-border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
            <div
              className={cn(
                'prose prose-sm max-w-none',
                // Light mode prose
                'prose-p:text-foreground prose-p:leading-relaxed prose-p:my-2',
                'prose-headings:text-foreground prose-headings:font-semibold',
                'prose-strong:text-foreground',
                'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
                'prose-li:text-foreground-secondary',
                'prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5',
                'prose-blockquote:border-accent/30 prose-blockquote:text-foreground-muted',
                'prose-hr:border-border',
                // Code blocks
                'prose-pre:bg-background-secondary prose-pre:border prose-pre:border-border prose-pre:rounded-xl',
                'prose-code:text-accent prose-code:before:content-[""] prose-code:after:content-[""]',
                // Dark mode overrides
                'dark:prose-invert',
                'dark:prose-pre:bg-background-tertiary dark:prose-pre:border-border'
              )}
            >
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Message metadata for AI messages */}
        {!isUser && (
          <div className="flex items-center gap-3 text-[10px] text-foreground-muted px-1 mt-1">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-success" />
              <span>Verified</span>
            </span>
            {/* <button className="flex items-center gap-1 hover:text-accent transition-colors">
              <ExternalLink className="w-3 h-3" />
              <span>Sources</span>
            </button> */}
          </div>
        )}

        {/* Timestamp */}
        <span className="text-[10px] text-foreground-muted font-medium px-0.5">
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
      <div className="inline-flex items-center gap-2 bg-background-secondary border border-border rounded-full px-3.5 py-1.5 max-w-[85%]">
        {isFileEvent ? (
          <FileText className="w-3 h-3 text-success shrink-0" />
        ) : (
          <Info className="w-3 h-3 text-foreground-muted shrink-0" />
        )}
        <span className="text-[11px] text-foreground-muted leading-tight truncate">
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