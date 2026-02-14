import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskDecompStore } from '@/stores/taskDecompStore';
import { 
  ChevronRight, 
  CheckCircle2, 
  Circle, 
  Loader2,
  TreePine,
  Layers,
  Activity,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const TaskDecompositionPanel: React.FC = () => {
  const { taskTree: rootTasks, isDecomposing } = useTaskDecompStore();

  return (
    <div className="h-full flex flex-col overflow-hidden">
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-2">
            <TreePine className="w-5 h-5 text-emerald-400" />
            <h2 className="font-semibold text-zinc-100">Task Map</h2>
          </div>
          {isDecomposing && (
            <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <div className="space-y-4">
            <AnimatePresence mode="popLayout">
              {rootTasks && rootTasks.map((task) => (
                <TaskNode key={task.id} task={task} level={0} />
              ))}
            </AnimatePresence>
            
            {(!rootTasks || rootTasks.length === 0) && (
              <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                <div className="w-12 h-12 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center mb-4">
                  <Layers className="w-6 h-6 text-zinc-700" />
                </div>
                <p className="text-zinc-300 text-sm font-medium">No tasks active</p>
                <p className="text-zinc-500 text-xs mt-1">Start a conversation to see task decomposition.</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-white/10 bg-white/5">
          <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
            <Activity className="w-3.5 h-3.5" />
            <span>Operational Tree</span>
          </div>
        </div>
      </div>
  );
};

interface TaskNodeProps {
  task: any; // Using any for brevity, should use the Task type from store
  level: number;
}

const TaskNode: React.FC<TaskNodeProps> = ({ task, level }) => {
  const hasChildren = task.subtasks && task.subtasks.length > 0;
  
  // Map backend states to UI statuses
  const getStatus = () => {
    switch (task.state?.toLowerCase()) {
      case 'done': return 'completed';
      case 'running': return 'in_progress';
      case 'failed': return 'error';
      default: return 'waiting';
    }
  };
  
  const status = getStatus();

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="space-y-2"
    >
      <div 
        className={cn(
          "group flex items-start gap-3 p-2 rounded-lg transition-colors cursor-default",
          level === 0 ? "bg-white/5" : "hover:bg-white/5"
        )}
      >
        <div className="mt-0.5">
          {status === 'completed' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : status === 'in_progress' ? (
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          ) : status === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-500" />
          ) : (
            <Circle className="w-4 h-4 text-zinc-600" />
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm font-medium leading-tight",
            status === 'completed' ? "text-zinc-500" : "text-zinc-200"
          )}>
            {task.content}
          </p>
          {task.assignedToName && (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[9px] text-zinc-500 uppercase tracking-tighter">Assigned:</span>
              <span className="text-[9px] text-blue-400 font-bold">{task.assignedToName}</span>
            </div>
          )}
        </div>

        {hasChildren && (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-transform" />
        )}
      </div>

      {hasChildren && (
        <div className="ml-6 border-l border-white/5 space-y-2 pl-2">
          {task.subtasks.map((subtask: any) => (
            <TaskNode key={subtask.id} task={subtask} level={level + 1} />
          ))}
        </div>
      )}
    </motion.div>
  );
};
