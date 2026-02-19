import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { z } from 'zod';
import { apiClient } from '@/lib/api';

const API_CONFIG_KEY = 'medgemma_api_config';

// Zod schema for API config validation
const ApiConfigSchema = z.object({
  geminiApiKey: z.string().min(1),
});

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

interface APIConfigState {
  // State
  geminiApiKey: string | null;
  isConfigured: boolean;
  isModalOpen: boolean;
  backendHasApiKey: boolean;
  backendModelPlatform: string;
  backendModelType: string;
  
  // Actions
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
  loadFromStorage: () => void;
  validateApiKey: (key: string) => boolean;
  setModalOpen: (open: boolean) => void;
  checkBackendConfig: () => Promise<void>;
}

export const useApiConfigStore = create<APIConfigState>()(
  immer((set, get) => ({
    // Initial state
    geminiApiKey: null,
    isConfigured: false,
    isModalOpen: false,
    backendHasApiKey: false,
    backendModelPlatform: '',
    backendModelType: '',
    
    setModalOpen: (open) => {
      set((state) => {
        state.isModalOpen = open;
      });
    },
    
    /**
     * Check if the backend has API key configured via .env
     */
    checkBackendConfig: async () => {
      try {
        const res = await apiClient.get('/config/status');
        const { has_api_key, model_platform, model_type } = res.data;
        set((state) => {
          state.backendHasApiKey = has_api_key;
          state.backendModelPlatform = model_platform || '';
          state.backendModelType = model_type || '';
          if (has_api_key) {
            state.isConfigured = true;
            state.isModalOpen = false;
          }
        });
      } catch (e) {
        console.warn('Failed to check backend config status:', e);
      }
    },
    
    /**
     * Set and save API key to localStorage
     */
    setApiKey: (key: string) => {
      const trimmed = key.trim();
      const validated = ApiConfigSchema.safeParse({ geminiApiKey: trimmed });
      
      if (validated.success) {
        try {
          localStorage.setItem(API_CONFIG_KEY, JSON.stringify({ geminiApiKey: trimmed }));
          set((state) => {
            state.geminiApiKey = trimmed;
            state.isConfigured = true;
            state.isModalOpen = false;
          });
        } catch (e) {
          console.error('Failed to save API config to localStorage:', e);
        }
      } else {
        console.error('Invalid API key format');
      }
    },
    
    /**
     * Clear API key from localStorage and state
     */
    clearApiKey: () => {
      try {
        localStorage.removeItem(API_CONFIG_KEY);
      } catch (e) {
        console.error('Failed to clear API config from localStorage:', e);
      }
      
      set((state) => {
        state.geminiApiKey = null;
        state.isConfigured = false;
        // Only reopen modal if backend also has no key
        state.isModalOpen = !get().backendHasApiKey;
      });
    },
    
    /**
     * Load API config from localStorage on app start,
     * then check backend config as fallback
     */
    loadFromStorage: () => {
      try {
        const stored = localStorage.getItem(API_CONFIG_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          const validated = ApiConfigSchema.safeParse(parsed);
          
          if (validated.success) {
            set((state) => {
              state.geminiApiKey = validated.data.geminiApiKey;
              state.isConfigured = true;
              state.isModalOpen = false;
            });
            return;
          } else {
            console.warn('Invalid stored API config, clearing...');
            localStorage.removeItem(API_CONFIG_KEY);
          }
        }
        // No valid localStorage key — check backend .env config
        get().checkBackendConfig();
      } catch (e) {
        console.error('Failed to load API config from localStorage:', e);
      }
    },
    
    /**
     * Validate an API key without saving it
     */
    validateApiKey: (key: string): boolean => {
      const trimmed = key.trim();
      return ApiConfigSchema.safeParse({ geminiApiKey: trimmed }).success;
    },
  }))
);
