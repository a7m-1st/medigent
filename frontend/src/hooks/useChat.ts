import { SSEConnection } from '@/lib/sse';
import * as chatService from '@/services/chatService';
import {
  useAgentStatusStore,
  useChatStore,
  useResourceStore,
  useTaskDecompStore,
} from '@/stores';
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
  sendHumanReply: (taskId: string, content: string) => Promise<void>;
  sendMessage: (question: string, attaches?: string[], config?: Partial<Chat>) => Promise<void>;
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
    async (data: Chat) => {
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
        store.clearMessages();
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
            if (sseRef.current === sse) {
              store.setError(error.message);
              store.setStreaming(false);
              store.setSSEConnected(false);
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
    async (question: string, attaches?: string[], config?: Partial<Chat>) => {
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
      const chatData: Chat = {
        task_id: taskId || `task-${Date.now()}`,
        project_id: projectId || `project-${Date.now()}`,
        question,
        attaches: attaches || [],
        model_platform: config?.model_platform || 'GEMINI',
        model_type: config?.model_type || 'GEMINI_3_FLASH',
        api_key: config?.api_key || '',
        api_url: config?.api_url ?? null,
        language: config?.language || 'en',
        browser_port: config?.browser_port || 9222,
        max_retries: config?.max_retries || 3,
        allow_local_system: config?.allow_local_system ?? false,
        installed_mcp: config?.installed_mcp || { mcpServers: {} },
        bun_mirror: config?.bun_mirror || '',
        uvx_mirror: config?.uvx_mirror || '',
        env_path: config?.env_path ?? null,
        summary_prompt: config?.summary_prompt || '',
        extra_params: config?.extra_params ?? null,
        search_config: config?.search_config ?? null,
      };
      await startChat(chatData);
    },
    [store, startChat]
  );

  const stopChat = useCallback(async () => {
    try {
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

      const projectId = store.currentProjectId;
      if (projectId) {
        await chatService.stopChat(projectId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop chat';
      store.setError(message);
    } finally {
      store.setLoading(false);
    }
  }, [store, cleanupSSE, taskDecompStore, agentStatusStore]);

  const sendHumanReply = useCallback(
    async (taskId: string, content: string) => {
      try {
        const projectId = store.currentProjectId;
        if (!projectId) {
          store.setError('No active project');
          return;
        }

        // Backend HumanReply expects { agent: string, reply: string }
        const data: HumanReply = {
          agent: taskId, // The agent name/id requesting input
          reply: content,
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
