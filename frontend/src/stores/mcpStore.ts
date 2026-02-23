import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

const MCP_CONFIG_KEY = 'medgemma_mcp_config';

export interface McpServerConfig {
  url: string;
  headers?: Record<string, string>;
  type?: 'sse' | 'streamable_http' | 'websocket';
}

interface McpState {
  servers: Record<string, McpServerConfig>;
  isDialogOpen: boolean;

  // Actions
  addServer: (name: string, config: McpServerConfig) => void;
  removeServer: (name: string) => void;
  updateServer: (name: string, config: McpServerConfig) => void;
  setDialogOpen: (open: boolean) => void;
  loadFromStorage: () => void;

  /** Returns the payload shape expected by the backend Chat model. */
  getInstalledMcp: () => { mcpServers: Record<string, McpServerConfig> };
}

function persistToStorage(servers: Record<string, McpServerConfig>) {
  try {
    localStorage.setItem(MCP_CONFIG_KEY, JSON.stringify(servers));
  } catch (e) {
    console.error('Failed to save MCP config to localStorage:', e);
  }
}

export const useMcpStore = create<McpState>()(
  immer((set, get) => ({
    servers: {},
    isDialogOpen: false,

    addServer: (name, config) => {
      set((state) => {
        state.servers[name] = config;
      });
      persistToStorage(get().servers);
    },

    removeServer: (name) => {
      set((state) => {
        delete state.servers[name];
      });
      persistToStorage(get().servers);
    },

    updateServer: (name, config) => {
      set((state) => {
        state.servers[name] = config;
      });
      persistToStorage(get().servers);
    },

    setDialogOpen: (open) => {
      set((state) => {
        state.isDialogOpen = open;
      });
    },

    loadFromStorage: () => {
      try {
        const stored = localStorage.getItem(MCP_CONFIG_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            set((state) => {
              state.servers = parsed;
            });
          }
        }
      } catch (e) {
        console.error('Failed to load MCP config from localStorage:', e);
      }
    },

    getInstalledMcp: () => {
      return { mcpServers: get().servers };
    },
  })),
);
