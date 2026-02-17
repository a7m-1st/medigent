import React from 'react';
import { useChatStore } from '@/stores';
import type { ErrorType } from '@/stores/chatStore';
import { AlertTriangle, XCircle, CreditCard, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

const ERROR_CONFIG: Record<Exclude<ErrorType, null>, {
  icon: React.ReactNode;
  title: string;
  bgClass: string;
  borderClass: string;
  iconClass: string;
  textClass: string;
}> = {
  rate_limit: {
    icon: <AlertTriangle className="w-4 h-4" />,
    title: 'Rate Limit Reached',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
    iconClass: 'text-amber-400',
    textClass: 'text-amber-200',
  },
  budget: {
    icon: <CreditCard className="w-4 h-4" />,
    title: 'Budget Exhausted',
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/30',
    iconClass: 'text-red-400',
    textClass: 'text-red-200',
  },
  generic: {
    icon: <XCircle className="w-4 h-4" />,
    title: 'Error',
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/30',
    iconClass: 'text-red-400',
    textClass: 'text-red-200',
  },
};

export const ErrorBanner: React.FC = () => {
  const error = useChatStore((s) => s.error);
  const errorType = useChatStore((s) => s.errorType);
  const clearError = useChatStore((s) => s.clearError);

  const config = errorType ? ERROR_CONFIG[errorType] : null;

  return (
    <AnimatePresence>
      {error && config && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden shrink-0"
        >
          <div
            className={`flex items-center gap-3 px-4 py-2.5 border-b ${config.bgClass} ${config.borderClass}`}
          >
            <span className={config.iconClass}>{config.icon}</span>
            <span className={`text-xs font-bold uppercase tracking-wider ${config.iconClass}`}>
              {config.title}
            </span>
            <span className={`text-xs ${config.textClass} flex-1 truncate`}>
              {error}
            </span>
            <button
              onClick={clearError}
              className="p-1 rounded hover:bg-white/10 transition-colors text-zinc-400 hover:text-zinc-200"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
