import { useState, type KeyboardEvent } from 'react';
import { useChat } from '@/hooks';
import { useTaskStore } from '@/stores';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Send, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MessageInput() {
  const [input, setInput] = useState('');
  const { startChat, stopChat, isStreaming, isLoading, currentProjectId } = useChat();
  const activeTaskId = useTaskStore((state) => state.activeTaskId);

  const handleSubmit = async () => {
    if (!input.trim() || isStreaming || isLoading) return;

    const content = input.trim();
    setInput('');

    // TODO: Get project ID and agents from context/props
    const projectId = currentProjectId || activeTaskId || 'default-project';
    
    // Always start a new chat session via /chat
    await startChat({
      project_id: projectId,
      task_id: `task-${Date.now()}`,
      question: content,
      attaches: [],
      model_platform: 'GEMINI',
      model_type: 'GEMINI_3_FLASH',
      api_key: '',
      language: 'en',
      browser_port: 9222,
      max_retries: 3,
      allow_local_system: false,
      installed_mcp: {},
      bun_mirror: '',
      uvx_mirror: '',
      summary_prompt: '',
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex gap-2 items-end">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message... (Shift+Enter for new line)"
        className="min-h-[80px] resize-none"
        disabled={isStreaming || isLoading}
      />
      {isStreaming ? (
        <Button
          onClick={stopChat}
          variant="destructive"
          className="shrink-0 h-[80px] px-6"
        >
          <Square className="h-5 w-5" />
        </Button>
      ) : (
        <Button
          onClick={handleSubmit}
          disabled={!input.trim() || isLoading}
          className={cn('shrink-0 h-[80px] px-6')}
        >
          <Send className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
