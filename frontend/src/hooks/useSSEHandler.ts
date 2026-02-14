import { useCallback } from 'react';
import { 
  SSEEventSchema, 
  type SSEEvent,
  type SSEConfirmedEvent,
  type SSECreateAgentEvent,
  type SSEActivateAgentEvent,
  type SSEDeactivateAgentEvent,
  type SSEActivateToolkitEvent,
  type SSEDeactivateToolkitEvent,
  type SSEDecomposeTextEvent,
  type SSEToSubTasksEvent,
  type SSEAssignTaskEvent,
  type SSETaskStateEvent,
  type SSTerminalEvent,
  type SSEWriteFileEvent,
  type SSENoticeEvent,
  type SSEAskEvent,
  type SSEEndEvent,
  type SSEErrorEvent,
} from '@/types';
import { 
  useAgentStatusStore, 
  useTaskDecompStore, 
  useResourceStore,
  useChatStore,
} from '@/stores';
import { MAIN_AGENT_NAMES } from '@/stores/agentStatusStore';
import * as taskService from '@/services/taskService';

// ============================================
// Main Agent Names check helper
// ============================================
function isMainAgent(name: string): boolean {
  return MAIN_AGENT_NAMES.includes(name as any);
}

/**
 * Hook to handle all SSE events and route to appropriate stores.
 * 
 * KEY DESIGN DECISION: The backend uses different agent_ids across different events
 * for the same agent. For example, create_agent might assign id "431ef789..." but
 * activate_agent uses id "b9acbcd8..." for the same document_agent. The agent_name
 * is the ONLY consistent identifier, so all lookups go through agent_name.
 */
export function useSSEHandler() {
  const agentStore = useAgentStatusStore();
  const taskStore = useTaskDecompStore();
  const resourceStore = useResourceStore();
  const chatStore = useChatStore();

  const handleEvent = useCallback((event: unknown) => {
    let validatedEvent: SSEEvent;
    
    const parsed = SSEEventSchema.safeParse(event);
    if (!parsed.success) {
      console.warn('Invalid SSE event received:', parsed.error.issues, event);
      return;
    }
    validatedEvent = parsed.data;

    const { data, step } = validatedEvent;

    switch (step) {
      case 'confirmed':
        handleConfirmed(data as SSEConfirmedEvent['data']);
        break;

      case 'create_agent':
        handleCreateAgent(data as SSECreateAgentEvent['data']);
        break;

      case 'activate_agent':
        handleActivateAgent(data as SSEActivateAgentEvent['data']);
        break;

      case 'deactivate_agent':
        handleDeactivateAgent(data as SSEDeactivateAgentEvent['data']);
        break;

      case 'activate_toolkit':
        handleActivateToolkit(data as SSEActivateToolkitEvent['data']);
        break;

      case 'deactivate_toolkit':
        handleDeactivateToolkit(data as SSEDeactivateToolkitEvent['data']);
        break;

      case 'decompose_text':
        handleDecomposeText(data as SSEDecomposeTextEvent['data']);
        break;

      case 'to_sub_tasks':
        handleToSubTasks(data as SSEToSubTasksEvent['data']);
        break;

      case 'assign_task':
        handleAssignTask(data as SSEAssignTaskEvent['data']);
        break;

      case 'task_state':
        handleTaskState(data as SSETaskStateEvent['data']);
        break;

      case 'terminal':
        handleTerminal(data as SSTerminalEvent['data']);
        break;

      case 'write_file':
        handleWriteFile(data as SSEWriteFileEvent['data']);
        break;

      case 'notice':
        handleNotice(data as SSENoticeEvent['data']);
        break;

      case 'ask':
        handleAsk(data as SSEAskEvent['data']);
        break;

      case 'end':
        handleEnd(data as SSEEndEvent['data']);
        break;

      case 'error':
        handleError(data as SSEErrorEvent['data']);
        break;

      case 'budget_not_enough':
        handleBudgetNotEnough(data);
        break;

      default:
        console.warn('Unhandled SSE event:', step);
    }
  }, [agentStore, taskStore, resourceStore, chatStore]);

  // ============================================
  // Event Handlers
  // ============================================

  function handleConfirmed(data: SSEConfirmedEvent['data']) {
    chatStore.setError(null);
    chatStore.addMessage({
      id: `confirmed-${Date.now()}`,
      role: 'user',
      content: data.question,
      timestamp: new Date().toISOString(),
    });
  }

  function handleCreateAgent(data: SSECreateAgentEvent['data']) {
    if (isMainAgent(data.agent_name)) {
      agentStore.createAgent(data.agent_id, data.agent_name, data.tools);
    }
  }

  function handleActivateAgent(data: SSEActivateAgentEvent['data']) {
    if (isMainAgent(data.agent_name)) {
      // Register the new agent_id (may differ from create_agent's ID)
      agentStore.registerAgentId(data.agent_name, data.agent_id);
      agentStore.setAgentWorking(data.agent_name, data.agent_id, data.process_task_id, data.message);
    }
  }

  function handleDeactivateAgent(data: SSEDeactivateAgentEvent['data']) {
    if (isMainAgent(data.agent_name)) {
      agentStore.registerAgentId(data.agent_name, data.agent_id);
      agentStore.setAgentCompleted(data.agent_name, data.agent_id, data.message, data.tokens);
    } else if (data.agent_name === 'task_summary_agent') {
      taskStore.setSummaryTask(data.message);
    }
  }

  function handleActivateToolkit(data: SSEActivateToolkitEvent['data']) {
    // Toolkit events only have agent_name, not agent_id
    if (isMainAgent(data.agent_name)) {
      agentStore.setAgentToolkit(data.agent_name, data.toolkit_name, data.method_name);
    }
  }

  function handleDeactivateToolkit(data: SSEDeactivateToolkitEvent['data']) {
    if (isMainAgent(data.agent_name)) {
      agentStore.clearAgentToolkit(data.agent_name);
    }
  }

  function handleDecomposeText(data: SSEDecomposeTextEvent['data']) {
    taskStore.appendDecomposeText(data.content);
  }

  function handleToSubTasks(data: SSEToSubTasksEvent['data']) {
    taskStore.setTaskTree(data.sub_tasks);
    if (data.summary_task) {
      taskStore.setSummaryTask(data.summary_task);
    }

    // Auto-start task execution when decomposition is final
    if (data.is_final && data.project_id) {
      console.log('[SSEHandler] Decomposition final, auto-starting task for project:', data.project_id);
      taskService.startTask(data.project_id).catch((err) => {
        console.error('[SSEHandler] Failed to auto-start task:', err);
        chatStore.setError('Failed to start task execution: ' + (err instanceof Error ? err.message : String(err)));
      });
    }
  }

  function handleAssignTask(data: SSEAssignTaskEvent['data']) {
    // Look up agent name by the assignee_id using the reverse lookup
    const agentName = agentStore.getAgentNameById(data.assignee_id);
    const agents = agentStore.agents;
    const agent = agentName ? agents[agentName] : undefined;
    const displayName = agent?.displayName || 'Agent';
    
    taskStore.assignTask(data.task_id, data.assignee_id, displayName);
    
    // Also update task state from the assign event
    taskStore.updateTaskState(data.task_id, data.state.toLowerCase());
    
    // Also update the agent's state if we know who it is
    if (agentName && isMainAgent(agentName)) {
      if (data.state === 'running') {
        agentStore.setAgentWorking(agentName, data.assignee_id, data.task_id, data.content);
      } else if (data.state === 'waiting') {
        agentStore.addAgentActivity(agentName, 'notice', `Assigned task: ${data.content.slice(0, 100)}...`);
      }
    }
  }

  function handleTaskState(data: SSETaskStateEvent['data']) {
    const normalizedState = data.state.toLowerCase();
    taskStore.updateTaskState(data.task_id, normalizedState);
    
    // If task failed, check if we can identify the agent and update its state
    if (normalizedState === 'failed' && data.result) {
      // Try to find which agent was working on this task
      const agents = agentStore.agents;
      for (const agentName of MAIN_AGENT_NAMES) {
        const agent = agents[agentName];
        if (agent && agent.currentTaskId === data.task_id) {
          agentStore.setAgentError(agentName, data.result.slice(0, 200));
          break;
        }
      }
    }
  }

  function handleTerminal(data: SSTerminalEvent['data']) {
    // Find which agent this terminal output belongs to by checking currentTaskId
    const agents = agentStore.agents;
    let foundAgent: { name: string; displayName: string } | null = null;
    
    for (const agentName of MAIN_AGENT_NAMES) {
      const agent = agents[agentName];
      if (agent && agent.currentTaskId === data.process_task_id) {
        foundAgent = { name: agentName, displayName: agent.displayName };
        break;
      }
    }
    
    if (foundAgent) {
      resourceStore.addTerminalOutput(
        foundAgent.name,
        data.process_task_id,
        foundAgent.displayName,
        data.data
      );
    } else {
      // Fallback: add to developer_agent since terminal is typically from that agent
      resourceStore.addTerminalOutput(
        'developer_agent',
        data.process_task_id,
        'Developer Agent',
        data.data
      );
    }
  }

  function handleWriteFile(data: SSEWriteFileEvent['data']) {
    chatStore.addMessage({
      id: `file-${Date.now()}`,
      role: 'system',
      content: `File created: ${data.file_path}`,
      timestamp: new Date().toISOString(),
    });
  }

  function handleNotice(data: SSENoticeEvent['data']) {
    // Add as chat message
    chatStore.addMessage({
      id: `notice-${Date.now()}`,
      role: 'system',
      content: data.notice,
      timestamp: new Date().toISOString(),
    });
    
    // Also find the agent working on this task and add to its activity log
    const agents = agentStore.agents;
    for (const agentName of MAIN_AGENT_NAMES) {
      const agent = agents[agentName];
      if (agent && agent.currentTaskId === data.process_task_id) {
        agentStore.addAgentActivity(agentName, 'notice', data.notice);
        break;
      }
    }
  }

  function handleAsk(data: SSEAskEvent['data']) {
    chatStore.addMessage({
      id: `ask-${Date.now()}`,
      role: 'assistant',
      content: `Question from ${data.agent}: ${data.question}`,
      timestamp: new Date().toISOString(),
    });
  }

  function handleEnd(data: SSEEndEvent['data']) {
    taskStore.setFinalSummary(data);
    
    chatStore.addMessage({
      id: `end-${Date.now()}`,
      role: 'assistant',
      content: data,
      timestamp: new Date().toISOString(),
    });
    
    chatStore.setStreaming(false);
    
    // Mark all working agents as completed
    const agents = agentStore.agents;
    for (const agentName of MAIN_AGENT_NAMES) {
      const agent = agents[agentName];
      if (agent && (agent.state === 'working')) {
        agentStore.setAgentCompleted(agentName, agent.knownIds[0] || '', 'Session ended', 0);
      }
    }
  }

  function handleError(data: SSEErrorEvent['data']) {
    chatStore.setError(data.message);
    chatStore.setStreaming(false);
  }

  function handleBudgetNotEnough(data: any) {
    chatStore.setError('Budget not enough: ' + (data.message || 'Insufficient budget'));
    chatStore.setStreaming(false);
  }

  return { handleEvent };
}
