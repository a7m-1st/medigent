import { z } from 'zod';
import { RoleEnum, StatusEnum, TimestampSchema, UUIDSchema } from './common';

// Agent model configuration (legacy - kept for compatibility)
export const AgentModelConfigSchema = z.object({
  platform: z.string(),
  model_name: z.string(),
  api_key_name: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
});
export type AgentModelConfig = z.infer<typeof AgentModelConfigSchema>;

// New agent schema (legacy - kept for compatibility)
export const NewAgentSchema = z.object({
  name: z.string().min(1),
  role: z.string(),
  model_config: AgentModelConfigSchema,
  system_prompt: z.string().optional(),
});
export type NewAgent = z.infer<typeof NewAgentSchema>;

// Agent configuration schema for secondary_agent (MedGemma)
export const AgentConfigSchema = z.object({
  api_url: z.string().optional(),
  model_platform: z.string().optional(),
  model_type: z.string().optional(),
  api_key: z.string().optional(),
  use_simulated_tool_calling: z.boolean().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// Chat request schema matching backend Chat model
// Backend expects attaches as list[str], not list of objects
export const ChatSchema = z.object({
  task_id: z.string(),
  project_id: z.string(),
  question: z.string().min(1),
  attaches: z.array(z.string()).default([]),
  model_platform: z.string(),
  model_type: z.string(),
  api_key: z.string(),
  api_url: z.string().nullable().optional(),
  language: z.string().default('en'),
  browser_port: z.number().default(9222),
  max_retries: z.number().default(3),
  allow_local_system: z.boolean().default(false),
  installed_mcp: z.record(z.string(), z.unknown()).default({}),
  bun_mirror: z.string().default(''),
  uvx_mirror: z.string().default(''),
  env_path: z.string().nullable().optional(),
  summary_prompt: z.string().default(''),
  extra_params: z.record(z.string(), z.unknown()).nullable().optional(),
  search_config: z.record(z.string(), z.unknown()).nullable().optional(),
  use_simulated_tool_calling: z.boolean().default(false),
  secondary_agent: AgentConfigSchema.nullable().optional(),
});
export type Chat = z.infer<typeof ChatSchema>;

// Continue/improve chat schema
// Backend SupplementChat expects attaches as list[str]
export const SupplementChatSchema = z.object({
  question: z.string().min(1),
  task_id: z.string().nullable().optional(),
  attaches: z.array(z.string()).default([]),
});
export type SupplementChat = z.infer<typeof SupplementChatSchema>;

// Human reply schema
export const HumanReplySchema = z.object({
  agent: z.string(),
  reply: z.string().min(1),
});
export type HumanReply = z.infer<typeof HumanReplySchema>;

// Chat message schema
// Using z.string() for id/timestamp to allow flexible internal message creation
export const ChatMessageSchema = z.object({
  id: z.string(),
  role: RoleEnum,
  content: z.string(),
  timestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  task_id: z.string().optional(),
  // Attachments: images as base64 data URLs
  images: z.array(z.string()).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Chat session schema
export const ChatSessionSchema = z.object({
  id: UUIDSchema,
  project_id: UUIDSchema,
  task_id: UUIDSchema.optional(),
  messages: z.array(ChatMessageSchema),
  status: StatusEnum,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

// Validation helpers
export const validateChatMessage = (message: unknown) => ChatMessageSchema.safeParse(message);
export const validateChatSession = (session: unknown) => ChatSessionSchema.safeParse(session);