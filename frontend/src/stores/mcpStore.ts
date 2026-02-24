import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';

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

export const useMcpStore = create<McpState>()(
  persist(
    immer((set, get) => ({
      servers: {},
      isDialogOpen: false,

      addServer: (name, config) => {
        set((state) => {
          state.servers[name] = config;
        });
      },

      removeServer: (name) => {
        set((state) => {
          delete state.servers[name];
        });
      },

      updateServer: (name, config) => {
        set((state) => {
          state.servers[name] = config;
        });
      },

      setDialogOpen: (open) => {
        set((state) => {
          state.isDialogOpen = open;
        });
      },

      loadFromStorage: () => {
        // No longer needed - persist middleware handles this automatically
      },

      getInstalledMcp: () => {
        return { mcpServers: JSON.parse(JSON.stringify(get().servers)) };
      },
    })),
    {
      name: MCP_CONFIG_KEY,
      partialize: (state) => ({
        servers: JSON.parse(JSON.stringify(state.servers)),
      }),
    }
  )
);
