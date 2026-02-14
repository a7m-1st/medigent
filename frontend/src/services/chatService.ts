import { apiRequest, handleApiError } from '@/lib/api';
import type {
  ChatMessage,
  HumanReply,
  SupplementChat,
} from '@/types';
import {
  ChatMessageSchema,
  HumanReplySchema,
  SupplementChatSchema,
} from '@/types';
import { z } from 'zod';

const ChatMessageArraySchema = z.array(ChatMessageSchema);

/**
 * Continue/improve an existing chat session.
 * Backend endpoint: POST /chat/{project_id}
 */
export async function continueChat(
  projectId: string,
  data: SupplementChat
): Promise<void> {
  try {
    const validatedData = SupplementChatSchema.parse(data);
    
    await apiRequest<void>({
      method: 'POST',
      url: `/chat/${projectId}`,
      data: validatedData,
      responseSchema: z.void(),
    });
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}

/**
 * Stop a running chat session.
 * Backend endpoint: DELETE /chat/{task_id}
 */
export async function stopChat(taskId: string): Promise<void> {
  try {
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Invalid task ID');
    }
    
    await apiRequest<void>({
      method: 'DELETE',
      url: `/chat/${taskId}`,
      responseSchema: z.void(),
    });
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}

/**
 * Send a human reply to an agent's question.
 * Backend endpoint: POST /chat/{project_id}/human-reply
 * Backend HumanReply model: { agent: string, reply: string }
 */
export async function sendHumanReply(
  projectId: string,
  data: HumanReply
): Promise<void> {
  try {
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('Invalid project ID');
    }
    
    const validatedData = HumanReplySchema.parse(data);
    
    await apiRequest<void>({
      method: 'POST',
      url: `/chat/${projectId}/human-reply`,
      data: validatedData,
      responseSchema: z.void(),
    });
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}

/**
 * Get chat history for a task.
 * Note: This endpoint may not exist on the current backend.
 */
export async function getChatHistory(taskId: string): Promise<ChatMessage[]> {
  try {
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Invalid task ID');
    }
    
    const response = await apiRequest<ChatMessage[]>({
      method: 'GET',
      url: `/chat/${taskId}/history`,
      responseSchema: ChatMessageArraySchema,
    });
    
    return response;
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}
