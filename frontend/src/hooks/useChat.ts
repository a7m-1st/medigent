import { encrypt } from '@/lib/encryption';
import { SSEConnection } from '@/lib/sse';
import * as chatService from '@/services/chatService';
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

// SSE endpoint - uses same base URL as REST API
const SSE_BASE_URL = import.meta.env.VITE_API_URL || '';

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
  const sseRef = useRef<SSEConnection<SSEEvent> | null>(null);
  const isConnectingRef = useRef(false);
  const { handleEvent } = useSSEHandler();

  // Track if component is mounted to prevent cleanup during React StrictMode
  const mountedRef = useRef(true);
  
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cleanupSSE = useCallback(() => {
    // Don't cleanup if we're in the middle of connecting (React StrictMode double-mount protection)
    if (isConnectingRef.current) {
      console.log('[useChat] Skipping cleanup - connection in progress');
      return;
    }
    if (sseRef.current) {
      sseRef.current.disconnect();
      sseRef.current = null;
    }
    store.setSSEConnected(false);
  }, [store]);

  useEffect(() => {
    return () => {
      // Only cleanup on unmount if we're actually unmounting (not StrictMode double-mount)
      if (!mountedRef.current) {
        cleanupSSE();
      }
    };
  }, []); // Empty deps - only run on unmount

  const startChat = useCallback(
    async (data: Chat, options?: { preserveMessages?: boolean }) => {
      console.log('[useChat] startChat called with data:', data);
      try {
        console.log('[useChat] Starting validation...');
        let validated;
        try {
          validated = ChatSchema.safeParse(data);
          console.log('[useChat] safeParse completed, success:', validated.success);
        } catch (parseError) {
          console.error('[useChat] safeParse threw an error:', parseError);
          throw parseError;
        }
        
        console.log('[useChat] Validation result:', validated.success ? 'SUCCESS' : 'FAILED');
        
        if (!validated.success) {
          const errorMsg = `Validation error: ${validated.error.issues.map((e: { message: string }) => e.message).join(', ')}`;
          console.error('[useChat] Validation errors:', validated.error.issues);
          store.setError(errorMsg);
          console.error('Chat validation failed:', validated.error);
          throw new Error(errorMsg); // Throw so caller knows it failed
        }

        console.log('[useChat] Validation passed, cleaning up SSE...');
        cleanupSSE();
        store.setLoading(true);
        store.setError(null);

        if (!options?.preserveMessages) {
          // Fresh session: preserve only the latest user message
          const freshMessages = useChatStore.getState().messages;
          const lastUserMessage = [...freshMessages].reverse().find(m => m.role === 'user');
          store.clearMessages();
          if (lastUserMessage) {
            store.addMessage(lastUserMessage);
          }
        }
        // When preserveMessages is true (follow-up in same project),
        // keep all existing messages intact — new responses will append.

        store.setCurrentProject(data.project_id);
        if (data.task_id) {
          store.setCurrentTask(data.task_id);
        }

        console.log('[useChat] Validated chat data:', JSON.stringify(validated.data, null, 2));

        // Reset related stores for a fresh session
        agentStatusStore.reset();
        taskDecompStore.reset();
        resourceStore.reset();

        // Start task decomposition tracking
        taskDecompStore.startDecomposition(data.project_id, data.task_id);

        console.log('[useChat] Creating SSE connection to:', `${SSE_BASE_URL}/chat`);
        const currentSseId = Date.now();
        const sse = new SSEConnection<SSEEvent>({
          url: `${SSE_BASE_URL}/chat`,
          method: 'POST',
          body: validated.data,
          eventSchema: SSEEventSchema,
          reconnectAttempts: 0, // Don't reconnect SSE POST streams - they're one-shot
          onOpen: () => {
            console.log(`[SSE ${currentSseId}] ✅ Connection opened`);
            store.setStreaming(true);
            store.setSSEConnected(true);
          },
          onMessage: (event) => {
            console.log(`[SSE ${currentSseId}] Message received:`, event);
            // Route ALL events through the SSE handler which dispatches to proper stores
            handleEvent(event);
          },
          onError: (error) => {
            console.error(`[SSE ${currentSseId}] ❌ Connection error:`, error.message);
            // Only update state if this is still the current connection
            // Note: Don't setLoading(false) here - SSE will auto-retry on errors like 429
            if (sseRef.current === sse) {
              store.setError(error.message);
            }
          },
          onClose: () => {
            console.log(`[SSE ${currentSseId}] 🔌 Connection closed, current=${sseRef.current === sse}`);
            // Only update state if this is still the current connection
            if (sseRef.current === sse) {
              store.setStreaming(false);
              store.setSSEConnected(false);
            }
          },
        });

        sseRef.current = sse;
        console.log('[useChat] Calling sse.connect()...');
        isConnectingRef.current = true;
        try {
          await sse.connect();
          console.log('[useChat] sse.connect() completed');
        } finally {
          isConnectingRef.current = false;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start chat';
        store.setError(message);
        store.setStreaming(false);
        store.setSSEConnected(false);
      } finally {
        store.setLoading(false);
      }
    },
    [store, cleanupSSE, handleEvent, agentStatusStore, taskDecompStore, resourceStore]
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

        // Backend endpoint: POST /chat/{project_id} for improve/continue
        // Note: Backend returns 201 with no body (not an SSE stream).
        // The improve action is queued into the existing task lock.
        // The original SSE stream from startChat must still be active to receive events.
        // If the original stream has already ended, the user should call startChat again
        // with a new session to get a fresh SSE stream.
        await chatService.continueChat(projectId, validated.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to continue chat';
        store.setError(message);
      } finally {
        store.setLoading(false);
      }
    },
    [store]
  );

  const sendMessage = useCallback(
    async (question: string, attaches?: string[], config?: Partial<Chat>, history?: ChatMessage[]) => {
      // Reset wasStopped flag at the start of a new send operation
      store.setWasStopped(false);
      
      const projectId = store.currentProjectId;
      const taskId = store.currentTaskId;
      
      console.log('[useChat] sendMessage called:', {
        projectId,
        taskId,
        hasExistingSSE: !!sseRef.current,
        sseState: sseRef.current?.getState(),
      });
      
      // Always start a new chat session via /chat
      console.log('[useChat] Starting new chat session via startChat');
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

      // Always generate a fresh taskId per turn (old task_lock is
      // deleted by backend when the previous SSE stream ends).
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

      // Set initial title from first user message (task_summary_agent
      // will override with a better title for complex tasks)
      const existingProject = projectStore.getProjectById(newProjectId);
      if (existingProject && existingProject.title === 'New Project') {
        const initialTitle = question.length > 60
          ? question.slice(0, 57) + '...'
          : question;
        projectStore.updateProject(newProjectId, { title: initialTitle });
      }

      // Persist the user message to projectStore BEFORE SSE starts,
      // so it's ordered before any agent responses in the persisted list.
      // addMessageToProject has dedup by message id, so later calls are no-ops.
      const latestUserMsg = useChatStore.getState().messages
        .filter(m => m.role === 'user')
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
        // api_key: config?.api_key || '',
        api_key: await encrypt(config?.api_key || ''),
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
      cleanupSSE();
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

      const taskId = store.currentTaskId;
      if (taskId) {
        await chatService.stopChat(taskId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop chat';
      store.setError(message);
    } finally {
      store.setLoading(false);
    }
  }, [store, cleanupSSE, taskDecompStore, agentStatusStore]);

  const sendHumanReply = useCallback(
    async (taskId: string, content: string, attaches?: string[]) => {
      try {
        const projectId = store.currentProjectId;
        if (!projectId) {
          store.setError('No active project');
          return;
        }

        // Backend HumanReply expects { agent: string, reply: string, attaches?: string[] }
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

        // Backend endpoint: POST /chat/{project_id}/human-reply
        await chatService.sendHumanReply(projectId, validated.data);
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
    cleanupSSE();
    store.reset();
    store.setSSEConnected(false);
    agentStatusStore.reset();
    taskDecompStore.reset();
    resourceStore.reset();
  }, [store, cleanupSSE, agentStatusStore, taskDecompStore, resourceStore]);

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
