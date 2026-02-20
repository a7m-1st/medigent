import { cn } from '@/lib/utils';
import { useAgentStatusStore, MAIN_AGENT_NAMES, MEDGEMMA_AGENTS, type AgentStatus } from '@/stores/agentStatusStore';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Crown,
  BookOpen,
  FileText,
  Scan,
  Stethoscope,
  Pill,
  Loader2,
  AlertCircle,
  Wrench,
  MessageSquare,
  Clock,
} from 'lucide-react';
import React, { useState } from 'react';

// Agent icon mapping
const AGENT_ICONS: Record<string, typeof Bot> = {
  attending_physician: Stethoscope,
  chief_of_medicine: Crown,
  clinical_pharmacologist: Pill,
  clinical_researcher: BookOpen,
  medical_scribe: FileText,
  radiologist: Scan,
};

// Format token count for display (e.g., 340K, 1.2M)
function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(0)}K tokens`;
  }
  return `${tokens} tokens`;
}

// Agent color mapping
const AGENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  attending_physician: {
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    text: 'text-orange-600 dark:text-orange-400',
    border: 'border-orange-200 dark:border-orange-800',
  },
  chief_of_medicine: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
  },
  clinical_pharmacologist: {
    bg: 'bg-teal-100 dark:bg-teal-900/30',
    text: 'text-teal-600 dark:text-teal-400',
    border: 'border-teal-200 dark:border-teal-800',
  },
  clinical_researcher: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-600 dark:text-green-400',
    border: 'border-green-200 dark:border-green-800',
  },
  medical_scribe: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    text: 'text-purple-600 dark:text-purple-400',
    border: 'border-purple-200 dark:border-purple-800',
  },
  radiologist: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-600 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800',
  },
};

export const AgentActivityPanel: React.FC = () => {
  const agents = useAgentStatusStore((s) => s.agents);

  // Get agents in order, only show ones that have been created
  const activeAgents = MAIN_AGENT_NAMES
    .map((name) => agents[name])
    .filter((agent): agent is AgentStatus => agent !== undefined);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Agent List */}
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-3">
        <AnimatePresence mode="popLayout">
          {activeAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-background-secondary border border-border flex items-center justify-center mb-4">
                <Bot className="w-6 h-6 text-foreground-muted" />
              </div>
              <p className="text-foreground font-medium text-sm">No agents active</p>
              <p className="text-foreground-muted text-xs mt-1">
                Agents will appear here when processing tasks.
              </p>
            </div>
          ) : (
            activeAgents.map((agent) => (
              <AgentCard key={agent.name} agent={agent} />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

interface AgentCardProps {
  agent: AgentStatus;
}

const AgentCard: React.FC<AgentCardProps> = ({ agent }) => {
  const [isExpanded, setIsExpanded] = useState(agent.state === 'working');
  const Icon = AGENT_ICONS[agent.name] || Bot;
  const colors = AGENT_COLORS[agent.name] || AGENT_COLORS.chief_of_medicine;

  // Parse the task content from lastInput to get just the task description
  const extractTaskDescription = (input: string | undefined): string => {
    if (!input) return '';
    // Try to extract the content between "==============================" markers
    const match = input.match(/the content of the task.*?is:\s*\n*={10,}\n*([\s\S]*?)\n*={10,}/i);
    if (match) {
      return match[1].trim().slice(0, 300);
    }
    // Fallback: just return first 300 chars
    return input.slice(0, 300);
  };

  // Parse output to get clean result
  const extractOutput = (output: string | undefined): string => {
    if (!output) return '';
    // Try to parse JSON output
    try {
      // Remove markdown code block if present
      const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        return parsed.content || output.slice(0, 500);
      }
      const parsed = JSON.parse(output);
      return parsed.content || output.slice(0, 500);
    } catch {
      return output.slice(0, 500);
    }
  };

  const taskDescription = extractTaskDescription(agent.lastInput);
  const outputContent = extractOutput(agent.lastOutput);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        'rounded-xl border overflow-hidden transition-all',
        agent.state === 'working' ? colors.border : 'border-border',
        agent.state === 'working' && 'shadow-sm'
      )}
    >
      {/* Agent Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'w-full flex items-center gap-3 p-3 transition-colors',
          agent.state === 'working' ? colors.bg : 'bg-card hover:bg-card-hover'
        )}
      >
        {/* Status Icon */}
        <div className={cn('relative', agent.state === 'working' && 'animate-pulse')}>
          {agent.state === 'working' ? (
            <Loader2 className={cn('w-5 h-5 animate-spin', colors.text)} />
          ) : agent.state === 'completed' ? (
            <CheckCircle2 className="w-5 h-5 text-success" />
          ) : agent.state === 'error' ? (
            <AlertCircle className="w-5 h-5 text-error" />
          ) : (
            <Circle className="w-5 h-5 text-foreground-muted" />
          )}
        </div>

        {/* Agent Info */}
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <Icon className={cn('w-4 h-4', colors.text)} />
            <span className={cn('text-sm font-medium', colors.text)}>
              {agent.displayName}
            </span>
            {MEDGEMMA_AGENTS.includes(agent.name) && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-600 dark:text-teal-400 font-medium">
                MedGemma
              </span>
            )}
          </div>
          {agent.state === 'working' && agent.currentToolkit && (
            <div className="flex items-center gap-1.5 mt-1">
              <Wrench className="w-3 h-3 text-foreground-muted" />
              <span className="text-[10px] text-foreground-muted truncate">
                {agent.currentToolkit} → {agent.currentMethod}
              </span>
            </div>
          )}
        </div>

        {/* Token count */}
        {agent.tokensUsed > 0 && (
          <span className="text-[10px] text-foreground-muted">
            {formatTokenCount(agent.tokensUsed)}
          </span>
        )}

        {/* Expand chevron */}
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-foreground-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-foreground-muted" />
        )}
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border bg-background-secondary"
          >
            <div className="p-3 space-y-3">
              {/* Current Task */}
              {taskDescription && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <MessageSquare className="w-3 h-3 text-foreground-muted" />
                    <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide">
                      Task
                    </span>
                  </div>
                  <div className="text-xs text-foreground-secondary bg-background-tertiary rounded-lg p-2.5 max-h-24 overflow-y-auto custom-scrollbar">
                    {taskDescription}
                  </div>
                </div>
              )}

              {/* Output */}
              {outputContent && agent.state !== 'working' && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <CheckCircle2 className="w-3 h-3 text-success" />
                    <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide">
                      Output
                    </span>
                  </div>
                  <div className="text-xs text-foreground-secondary bg-background-tertiary rounded-lg p-2.5 max-h-32 overflow-y-auto custom-scrollbar">
                    {outputContent}
                  </div>
                </div>
              )}

              {/* Activity Log */}
              {agent.activityLog.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Clock className="w-3 h-3 text-foreground-muted" />
                    <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide">
                      Activity ({agent.activityLog.length})
                    </span>
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                    {agent.activityLog.slice(-5).reverse().map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-start gap-2 text-[10px] py-1"
                      >
                        <span className="text-foreground-muted shrink-0">
                          {entry.timestamp.toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                        <span
                          className={cn(
                            'truncate',
                            entry.type === 'error' ? 'text-error' :
                            entry.type === 'toolkit_start' || entry.type === 'toolkit_end' ? 'text-accent' :
                            'text-foreground-secondary'
                          )}
                        >
                          {entry.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};