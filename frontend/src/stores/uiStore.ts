import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

interface UIState {
  // State
  sidebarOpen: boolean
  theme: 'light' | 'dark' | 'system'
  activeModal: string | null
  toasts: Array<{
    id: string
    type: 'success' | 'error' | 'warning' | 'info'
    message: string
  }>

  // Actions
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  openModal: (modalId: string) => void
  closeModal: () => void
  addToast: (toast: Omit<UIState['toasts'][0], 'id'>) => void
  removeToast: (id: string) => void
}

const initialState = {
  sidebarOpen: true,
  theme: 'system' as const,
  activeModal: null,
  toasts: [],
}

export const useUIStore = create<UIState>()(
  immer((set) => ({
    ...initialState,

    toggleSidebar: () =>
      set((state) => {
        state.sidebarOpen = !state.sidebarOpen
      }),

    setSidebarOpen: (open) =>
      set((state) => {
        state.sidebarOpen = open
      }),

    setTheme: (theme) =>
      set((state) => {
        state.theme = theme
      }),

    openModal: (modalId) =>
      set((state) => {
        state.activeModal = modalId
      }),

    closeModal: () =>
      set((state) => {
        state.activeModal = null
      }),

    addToast: (toast) =>
      set((state) => {
        const id = Math.random().toString(36).substring(7)
        state.toasts.push({ ...toast, id })
      }),

    removeToast: (id) =>
      set((state) => {
        state.toasts = state.toasts.filter((t) => t.id !== id)
      }),
  }))
)
