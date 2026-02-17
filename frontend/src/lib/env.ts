/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
}

// Prevent TS6196: ImportMetaEnv is declared but never used
export type { ImportMetaEnv }

export const env = {
  VITE_API_URL: import.meta.env.VITE_API_URL || '',
} as const
