import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';

export interface SSEOptions<TEvent> {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  eventSchema: ZodSchema<TEvent>;
  onMessage?: (data: TEvent) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
}

export interface SSEConnectionState {
  isConnected: boolean;
  isConnecting: boolean;
  reconnectCount: number;
  lastError?: Error;
}

export class SSEConnection<TEvent> {
  private eventSource: EventSource | null = null;
  private abortController: AbortController | null = null;
  private options: SSEOptions<TEvent>;
  private state: SSEConnectionState = {
    isConnected: false,
    isConnecting: false,
    reconnectCount: 0,
  };
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentReconnectDelay: number;

  constructor(options: SSEOptions<TEvent>) {
    this.options = {
      method: 'GET',
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      ...options,
    };
    this.currentReconnectDelay = this.options.reconnectDelay!;
  }

  getState(): SSEConnectionState {
    return { ...this.state };
  }

  async connect(): Promise<void> {
    if (this.state.isConnected || this.state.isConnecting) {
      return;
    }

    this.state.isConnecting = true;

    try {
      if (this.options.method === 'POST' || this.options.body) {
        await this.connectWithFetch();
      } else {
        this.connectWithEventSource();
      }
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private connectWithEventSource(): void {
    const url = new URL(this.options.url, window.location.origin);
    
    if (this.options.body && typeof this.options.body === 'object') {
      Object.entries(this.options.body).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    this.eventSource = new EventSource(url.toString());

    this.eventSource.onopen = () => {
      this.state.isConnected = true;
      this.state.isConnecting = false;
      this.state.reconnectCount = 0;
      this.currentReconnectDelay = this.options.reconnectDelay!;
      this.options.onOpen?.();
    };

    this.eventSource.onmessage = (event) => {
      this.parseAndEmitEvent(event.data);
    };

    this.eventSource.onerror = (_event) => {
      const error = new Error('SSE connection error');
      this.handleError(error);
    };
  }

  private async connectWithFetch(): Promise<void> {
    this.abortController = new AbortController();
    
    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      ...this.options.headers,
    };

    const token = localStorage.getItem('auth_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(this.options.url, {
        method: this.options.method,
        headers,
        body: this.options.body ? JSON.stringify(this.options.body) : undefined,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      this.state.isConnected = true;
      this.state.isConnecting = false;
      this.state.reconnectCount = 0;
      this.currentReconnectDelay = this.options.reconnectDelay!;
      this.options.onOpen?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim().startsWith('data:')) {
            const data = line.trim().substring(5).trim();
            if (data) {
              this.parseAndEmitEvent(data);
            }
          }
        }
      }

      this.options.onClose?.();
      this.state.isConnected = false;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      throw error;
    }
  }

  private parseAndEmitEvent(data: string): void {
    try {
      let parsedData: unknown;
      
      try {
        parsedData = JSON.parse(data);
      } catch {
        parsedData = { message: data };
      }

      const validatedData = this.options.eventSchema.parse(parsedData);
      this.options.onMessage?.(validatedData);
    } catch (error) {
      if (error instanceof ZodError) {
        console.error('SSE event validation failed:', error.issues);
        this.options.onError?.(new Error(`Event validation failed: ${error.issues.map(e => e.message).join(', ')}`));
      } else {
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private handleError(error: Error): void {
    this.state.isConnected = false;
    this.state.isConnecting = false;
    this.state.lastError = error;
    this.options.onError?.(error);

    if (this.state.reconnectCount < (this.options.reconnectAttempts || 0)) {
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    this.state.reconnectCount++;
    
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.currentReconnectDelay);

    this.currentReconnectDelay = Math.min(
      this.currentReconnectDelay * 2,
      this.options.maxReconnectDelay!
    );
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.abortController?.abort();
    this.abortController = null;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.state.isConnected = false;
    this.state.isConnecting = false;
    this.options.onClose?.();
  }
}

export function createSSEConnection<TEvent>(
  options: SSEOptions<TEvent>
): SSEConnection<TEvent> {
  return new SSEConnection(options);
}
