import { useCallback, useEffect, useRef, useState } from 'react';
import { SSEConnection } from '@/lib/sse';
import type { SSEOptions, SSEConnectionState } from '@/lib/sse';

export interface UseSSEOptions<TEvent> extends Omit<SSEOptions<TEvent>, 'onMessage' | 'onError' | 'onOpen' | 'onClose'> {
  autoConnect?: boolean;
  onMessage?: (data: TEvent) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export interface UseSSEReturn<TEvent> {
  connectionState: SSEConnectionState;
  isConnected: boolean;
  isConnecting: boolean;
  lastError: Error | undefined;
  connect: () => Promise<void>;
  disconnect: () => void;
  reconnect: () => Promise<void>;
  lastMessage: TEvent | null;
}

export function useSSE<TEvent>(url: string, options?: Partial<UseSSEOptions<TEvent>>): UseSSEReturn<TEvent> {
  const connectionRef = useRef<SSEConnection<TEvent> | null>(null);
  const [connectionState, setConnectionState] = useState<SSEConnectionState>({
    isConnected: false,
    isConnecting: false,
    reconnectCount: 0,
  });
  const [lastMessage, setLastMessage] = useState<TEvent | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const updateState = useCallback(() => {
    if (connectionRef.current) {
      setConnectionState(connectionRef.current.getState());
    }
  }, []);

  const connect = useCallback(async () => {
    if (connectionRef.current?.getState().isConnected || connectionRef.current?.getState().isConnecting) {
      return;
    }

    const eventSchema = optionsRef.current?.eventSchema;
    if (!eventSchema) {
      throw new Error('eventSchema is required');
    }

    const connection = new SSEConnection<TEvent>({
      url,
      method: optionsRef.current?.method || 'GET',
      headers: optionsRef.current?.headers,
      body: optionsRef.current?.body,
      eventSchema,
      onOpen: () => {
        updateState();
        optionsRef.current?.onOpen?.();
      },
      onMessage: (data) => {
        setLastMessage(data);
        updateState();
        optionsRef.current?.onMessage?.(data);
      },
      onError: (error) => {
        updateState();
        optionsRef.current?.onError?.(error);
      },
      onClose: () => {
        updateState();
        optionsRef.current?.onClose?.();
      },
      reconnectAttempts: optionsRef.current?.reconnectAttempts,
      reconnectDelay: optionsRef.current?.reconnectDelay,
      maxReconnectDelay: optionsRef.current?.maxReconnectDelay,
    });

    connectionRef.current = connection;
    await connection.connect();
    updateState();
  }, [url, updateState]);

  const disconnect = useCallback(() => {
    if (connectionRef.current) {
      connectionRef.current.disconnect();
      connectionRef.current = null;
    }
    setConnectionState({
      isConnected: false,
      isConnecting: false,
      reconnectCount: 0,
    });
  }, []);

  const reconnect = useCallback(async () => {
    disconnect();
    await connect();
  }, [disconnect, connect]);

  useEffect(() => {
    if (options?.autoConnect && options?.eventSchema) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [url, options?.autoConnect]);

  return {
    connectionState,
    isConnected: connectionState.isConnected,
    isConnecting: connectionState.isConnecting,
    lastError: connectionState.lastError,
    connect,
    disconnect,
    reconnect,
    lastMessage,
  };
}
