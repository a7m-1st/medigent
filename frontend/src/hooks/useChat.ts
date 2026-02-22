import { WSConnection, getWSUrl } from '@/lib/ws';
import {
  useAgentStatusStore,
  useChatStore,
  useResourceStore,
  useTaskDecompStore,
} from '@/stores';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { useProjectStore } from '@/stores/projectStore';
import type {
  Chat,
  ChatMessage,
  HumanReply,
  SSEEvent,
  SupplementChat,
} from '@/types';
import {
  ChatSchema,
  HumanReplySchema,
  SSEEventSchema,
  SupplementChatSchema,
} from '@/types';
import { useCallback, useEffect, useRef } from 'react';
import { useSSEHandler } from './useSSEHandler';

// API base URL — used to derive the WS URL
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Default model configuration from environment variables
const DEFAULT_MODEL_PLATFORM = import.meta.env.VITE_DEFAULT_MODEL_PLATFORM || 'GEMINI';
const DEFAULT_MODEL_TYPE = import.meta.env.VITE_DEFAULT_MODEL_TYPE || 'GEMINI_3_FLASH';
const DEFAULT_MODEL_API_URL = import.meta.env.VITE_DEFAULT_MODEL_API_URL || null;

export interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  isLoading: boolean;
  currentTaskId: string | null;
  currentProjectId: string | null;
  error: string | null;
  streamingContent: string;
  isSSEConnected: boolean;
  startChat: (data: Chat) => Promise<void>;
  continueChat: (data: SupplementChat) => Promise<void>;
  stopChat: () => Promise<void>;
  sendHumanReply: (taskId: string, content: string, attaches?: string[]) => Promise<void>;
  sendMessage: (question: string, attaches?: string[], config?: Partial<Chat>, history?: ChatMessage[]) => Promise<void>;
  clearMessages: () => void;
  reset: () => void;
}

export function useChat(): UseChatReturn {
  const store = useChatStore();
  const agentStatusStore = useAgentStatusStore();
  const taskDecompStore = useTaskDecompStore();
  const resourceStore = useResourceStore();
  const wsRef = useRef<WSConnection<SSEEvent> | null>(null);
  const isConnectingRef = useRef(false);

  // Callback for useSSEHandler: sends start_task over the existing WS
  const startTaskViaWS = useCallback((projectId: string) => {
    if (wsRef.current && wsRef.current.getState().isConnected) {
      wsRef.current.send('start_task', { project_id: projectId });
    } else {
      console.warn('[useChat] WS not connected, cannot send start_task');
    }
  }, []);

  const { handleEvent } = useSSEHandler({ onStartTask: startTaskViaWS });

  // Track if component is mounted to prevent cleanup during React StrictMode
  const mountedRef = useRef(true);
  
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cleanupWS = useCallback(() => {
    // Don't cleanup if we're in the middle of connecting (React StrictMode double-mount protection)
    if (isConnectingRef.current) {
      console.log('[useChat] Skipping cleanup - connection in progress');
      return;
    }
    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
    }
    store.setSSEConnected(false);
  }, [store]);

  useEffect(() => {
    return () => {
      // Only cleanup on unmount if we're actually unmounting (not StrictMode double-mount)
      if (!mountedRef.current) {
        cleanupWS();
      }
    };
  }, []); // Empty deps - only run on unmount

  /**
   * Ensure a WebSocket connection is open.  If one already exists and is
   * connected, reuse it.  Otherwise create a new one.  Returns the
   * ``WSConnection`` instance.
   */
  const ensureWS = useCallback(async (): Promise<WSConnection<SSEEvent>> => {
    if (wsRef.current && wsRef.current.getState().isConnected) {
      return wsRef.current;
    }

    // Tear down stale reference if any
    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
    }

    const wsUrl = getWSUrl(API_BASE_URL);
    console.log('[useChat] Creating WebSocket connection to:', wsUrl);

    const ws = new WSConnection<SSEEvent>({
      url: wsUrl,
      eventSchema: SSEEventSchema,
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      onOpen: () => {
        console.log('[WS] Connection opened');
        store.setSSEConnected(true);
      },
      onMessage: (event) => {
        console.log('[WS] Message received:', event);
        handleEvent(event);
      },
      onError: (error) => {
        console.error('[WS] Connection error:', error.message);
        if (wsRef.current === ws) {
          store.setError(error.message);
        }
      },
      onClose: (_code, _reason) => {
        console.log(`[WS] Connection closed (code=${_code})`);
        if (wsRef.current === ws) {
          store.setStreaming(false);
          store.setSSEConnected(false);
        }
      },
    });

    wsRef.current = ws;
    isConnectingRef.current = true;
    try {
      await ws.connect();
      console.log('[useChat] WebSocket connected');
    } finally {
      isConnectingRef.current = false;
    }

    return ws;
  }, [store, handleEvent]);

  const startChat = useCallback(
    async (data: Chat, options?: { preserveMessages?: boolean }) => {
      console.log('[useChat] startChat called with data:', data);
      try {
        let validated;
        try {
          validated = ChatSchema.safeParse(data);
        } catch (parseError) {
          console.error('[useChat] safeParse threw an error:', parseError);
          throw parseError;
        }
        
        if (!validated.success) {
          const errorMsg = `Validation error: ${validated.error.issues.map((e: { message: string }) => e.message).join(', ')}`;
          console.error('[useChat] Validation errors:', validated.error.issues);
          store.setError(errorMsg);
          throw new Error(errorMsg);
        }

        store.setLoading(true);
        store.setError(null);

        if (!options?.preserveMessages) {
          // Fresh session: preserve only the latest user message
          const freshMessages = useChatStore.getState().messages;
          const lastUserMessage = [...freshMessages].reverse().find((m: ChatMessage) => m.role === 'user');
          store.clearMessages();
          if (lastUserMessage) {
            store.addMessage(lastUserMessage);
          }
        }

        store.setCurrentProject(data.project_id);
        if (data.task_id) {
          store.setCurrentTask(data.task_id);
        }

        // Reset related stores for a fresh session
        agentStatusStore.reset();
        taskDecompStore.reset();
        resourceStore.reset();

        // Start task decomposition tracking
        taskDecompStore.startDecomposition(data.project_id, data.task_id);

        // Ensure WebSocket is connected and send start_chat
        const ws = await ensureWS();
        store.setStreaming(true);
        ws.send('start_chat', validated.data);

        console.log('[useChat] start_chat sent over WebSocket');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start chat';
        store.setError(message);
        store.setStreaming(false);
        store.setSSEConnected(false);
      } finally {
        store.setLoading(false);
      }
    },
    [store, ensureWS, agentStatusStore, taskDecompStore, resourceStore]
  );

  const continueChat = useCallback(
    async (data: SupplementChat) => {
      try {
        const validated = SupplementChatSchema.safeParse(data);
        if (!validated.success) {
          store.setError(`Validation error: ${validated.error.issues.map((e: { message: string }) => e.message).join(', ')}`);
          return;
        }

        const projectId = store.currentProjectId;
        if (!projectId) {
          store.setError('No active project to continue chat');
          return;
        }

        store.setLoading(true);
        store.setError(null);

        // Send improve message over the existing WebSocket connection
        const ws = await ensureWS();
        ws.send('improve', validated.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to continue chat';
        store.setError(message);
      } finally {
        store.setLoading(false);
      }
    },
    [store, ensureWS]
  );

  const sendMessage = useCallback(
    async (question: string, attaches?: string[], config?: Partial<Chat>, history?: ChatMessage[]) => {
      // Reset wasStopped flag at the start of a new send operation
      store.setWasStopped(false);
      
      const projectId = store.currentProjectId;
      
      console.log('[useChat] sendMessage called:', {
        projectId,
        hasExistingWS: !!wsRef.current,
        wsState: wsRef.current?.getState(),
      });
      
      // Merge provided config with defaults
      const { medgemmaHostUrl, medgemmaModelType, medgemmaContextSize } = useApiConfigStore.getState();
      const secondaryAgent = medgemmaHostUrl
        ? {
            api_url: medgemmaHostUrl,
            model_platform: 'openai-compatible-model',
            model_type: medgemmaModelType || undefined,
            use_simulated_tool_calling: true,
            model_context_size: medgemmaContextSize ?? undefined,
          }
        : config?.secondary_agent;

      // Always generate a fresh taskId per turn
      const newTaskId = `task-${Date.now()}`;
      const newProjectId = projectId || `project-${Date.now()}`;
      const isFollowUp = !!projectId;

      // Auto-create project in projectStore if it doesn't exist yet
      const projectStore = useProjectStore.getState();
      if (!projectStore.getProjectById(newProjectId)) {
        projectStore.createProject(newProjectId);
      }
      // Track the taskId in the project
      projectStore.addTaskToProject(newProjectId, newTaskId);

      // Set initial title from first user message
      const existingProject = projectStore.getProjectById(newProjectId);
      if (existingProject && existingProject.title === 'New Project') {
        const initialTitle = question.length > 60
          ? question.slice(0, 57) + '...'
          : question;
        projectStore.updateProject(newProjectId, { title: initialTitle });
      }

      // Persist the user message to projectStore BEFORE WS starts
      const latestUserMsg = useChatStore.getState().messages
        .filter((m: ChatMessage) => m.role === 'user')
        .pop();
      if (latestUserMsg) {
        projectStore.addMessageToProject(newProjectId, latestUserMsg);
      }

      const chatData: Chat = {
        task_id: newTaskId,
        project_id: newProjectId,
        question,
        attaches: attaches || [],
        model_platform: config?.model_platform || DEFAULT_MODEL_PLATFORM,
        model_type: config?.model_type || DEFAULT_MODEL_TYPE,
        api_key: config?.api_key || '',
        api_url: config?.api_url ?? DEFAULT_MODEL_API_URL,
        max_retries: config?.max_retries || 5,
        installed_mcp: config?.installed_mcp || { mcpServers: {} },
        summary_prompt: config?.summary_prompt || '',
        use_simulated_tool_calling: false,
        secondary_agent: secondaryAgent ?? null,
        history: history || [],
      };
      await startChat(chatData, { preserveMessages: isFollowUp });
    },
    [store, startChat]
  );

  const stopChat = useCallback(async () => {
    try {
      store.setWasStopped(true);
      store.setStreaming(false);
      store.setSSEConnected(false);
      store.setLoading(true);

      // Cancel all pending/running tasks in the task tree
      taskDecompStore.cancelPendingTasks();
      
      // Mark all working agents as completed (session stopped by user)
      const agents = agentStatusStore.agents;
      for (const name of Object.keys(agents)) {
        const agent = agents[name];
        if (agent && agent.state === 'working') {
          agentStatusStore.setAgentCompleted(name, agent.knownIds[0] || '', 'Stopped by user', 0);
        }
      }

      // Send stop via WebSocket if connected, otherwise fall back to REST
      if (wsRef.current && wsRef.current.getState().isConnected) {
        wsRef.current.send('stop', {});
      } else {
        // Fallback: use REST endpoint
        const taskId = store.currentTaskId;
        if (taskId) {
          const { stopChat: restStopChat } = await import('@/services/chatService');
          await restStopChat(taskId);
        }
      }

      // Disconnect the WebSocket after stopping
      cleanupWS();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop chat';
      store.setError(message);
    } finally {
      store.setLoading(false);
    }
  }, [store, cleanupWS, taskDecompStore, agentStatusStore]);

  const sendHumanReply = useCallback(
    async (taskId: string, content: string, attaches?: string[]) => {
      try {
        const projectId = store.currentProjectId;
        if (!projectId) {
          store.setError('No active project');
          return;
        }

        const data: HumanReply = {
          agent: taskId, // The agent name/id requesting input
          reply: content,
          attaches: attaches || [],
        };

        const validated = HumanReplySchema.safeParse(data);
        if (!validated.success) {
          store.setError(`Validation error: ${validated.error.issues.map((e: { message: string }) => e.message).join(', ')}`);
          return;
        }

        store.setLoading(true);
        store.setError(null);

        // Send human_reply over WebSocket if connected, otherwise REST fallback
        if (wsRef.current && wsRef.current.getState().isConnected) {
          wsRef.current.send('human_reply', validated.data);
        } else {
          const { sendHumanReply: restSendHumanReply } = await import('@/services/chatService');
          await restSendHumanReply(projectId, validated.data);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send reply';
        store.setError(message);
      } finally {
        store.setLoading(false);
      }
    },
    [store]
  );

  const clearMessages = useCallback(() => {
    store.clearMessages();
  }, [store]);

  const reset = useCallback(() => {
    cleanupWS();
    store.reset();
    store.setSSEConnected(false);
    agentStatusStore.reset();
    taskDecompStore.reset();
    resourceStore.reset();
  }, [store, cleanupWS, agentStatusStore, taskDecompStore, resourceStore]);

  return {
    messages: store.messages,
    isStreaming: store.isStreaming,
    isLoading: store.isLoading,
    currentTaskId: store.currentTaskId,
    currentProjectId: store.currentProjectId,
    error: store.error,
    streamingContent: store.streamingContent,
    isSSEConnected: store.isSSEConnected,
    startChat,
    continueChat,
    stopChat,
    sendHumanReply,
    sendMessage,
    clearMessages,
    reset,
  };
}
