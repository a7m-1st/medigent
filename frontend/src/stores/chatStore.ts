import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ChatMessage } from '@/types'

interface ChatState {
  // State
  messages: ChatMessage[]
  currentTaskId: string | null
  currentProjectId: string | null
  isStreaming: boolean
  isLoading: boolean
  error: string | null
  streamingContent: string
  isSSEConnected: boolean

  // Actions
  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  appendStreamingContent: (content: string) => void
  clearStreamingContent: () => void
  setStreaming: (isStreaming: boolean) => void
  setLoading: (isLoading: boolean) => void
  setCurrentTask: (taskId: string | null) => void
  setCurrentProject: (projectId: string | null) => void
  setError: (error: string | null) => void
  setSSEConnected: (isConnected: boolean) => void
  clearMessages: () => void
  reset: () => void
}

const initialState = {
  messages: [],
  currentTaskId: null,
  currentProjectId: null,
  isStreaming: false,
  isLoading: false,
  error: null,
  streamingContent: '',
  isSSEConnected: false,
}

export const useChatStore = create<ChatState>()(
  immer((set) => ({
    ...initialState,

    addMessage: (message) =>
      set((state) => {
        state.messages.push(message)
      }),

    updateMessage: (id, updates) =>
      set((state) => {
        const message = state.messages.find((m) => m.id === id)
        if (message) {
          Object.assign(message, updates)
        }
      }),

    appendStreamingContent: (content) =>
      set((state) => {
        state.streamingContent += content
      }),

    clearStreamingContent: () =>
      set((state) => {
        state.streamingContent = ''
      }),

    setStreaming: (isStreaming) =>
      set((state) => {
        state.isStreaming = isStreaming
        if (!isStreaming) {
          state.streamingContent = ''
        }
      }),

    setLoading: (isLoading) =>
      set((state) => {
        state.isLoading = isLoading
      }),

    setCurrentTask: (taskId) =>
      set((state) => {
        state.currentTaskId = taskId
      }),

    setCurrentProject: (projectId) =>
      set((state) => {
        state.currentProjectId = projectId
      }),

    setError: (error) =>
      set((state) => {
        state.error = error
      }),

    setSSEConnected: (isConnected) =>
      set((state) => {
        state.isSSEConnected = isConnected
      }),

    clearMessages: () =>
      set((state) => {
        state.messages = []
      }),

    reset: () =>
      set((state) => {
        Object.assign(state, initialState)
      }),
  }))
)
