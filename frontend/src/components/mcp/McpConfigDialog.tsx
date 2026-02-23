import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMcpStore, type McpServerConfig } from '@/stores/mcpStore';
import { Plug, Plus, Trash2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';

export const McpConfigDialog: React.FC = () => {
  const {
    servers,
    isDialogOpen,
    setDialogOpen,
    addServer,
    removeServer,
    loadFromStorage,
  } = useMcpStore();

  // Load persisted MCP config on mount
  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<string>('auto');
  const [headerKey, setHeaderKey] = useState('');
  const [headerValue, setHeaderValue] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});

  const serverEntries = Object.entries(servers);

  const resetForm = () => {
    setName('');
    setUrl('');
    setTransport('auto');
    setHeaderKey('');
    setHeaderValue('');
    setHeaders({});
  };

  const handleAddHeader = () => {
    const k = headerKey.trim();
    const v = headerValue.trim();
    if (k && v) {
      setHeaders((prev) => ({ ...prev, [k]: v }));
      setHeaderKey('');
      setHeaderValue('');
    }
  };

  const handleRemoveHeader = (key: string) => {
    setHeaders((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleAddServer = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) return;

    const config: McpServerConfig = { url: trimmedUrl };
    if (transport !== 'auto') {
      config.type = transport as McpServerConfig['type'];
    }
    if (Object.keys(headers).length > 0) {
      config.headers = { ...headers };
    }

    addServer(trimmedName, config);
    resetForm();
  };

  const canAdd = name.trim().length > 0 && url.trim().length > 0;

  const getTransportLabel = (config: McpServerConfig) => {
    if (config.type) return config.type.toUpperCase().replace('_', ' ');
    if (config.url.startsWith('ws://') || config.url.startsWith('wss://'))
      return 'WebSocket';
    return 'HTTP';
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-lg bg-card border-border text-foreground max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 bg-accent-light rounded-full flex items-center justify-center mb-4">
            <Plug className="w-6 h-6 text-accent" />
          </div>
          <DialogTitle className="text-xl font-bold text-center">
            MCP Servers
          </DialogTitle>
          <DialogDescription className="text-foreground-muted text-center text-sm">
            Configure remote MCP servers to extend agent capabilities with
            external tools.
          </DialogDescription>
        </DialogHeader>

        {/* Info banner */}
        {/* <div className="flex items-start gap-2 rounded-lg bg-accent/5 border border-accent/20 px-3 py-2 text-xs text-foreground-muted">
          <Plug className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <span>
            MCP servers are connected when you send a message. Changes take
            effect on the next conversation.
          </span>
        </div> */}

        {/* Server list */}
        {serverEntries.length > 0 ? (
          <div className="space-y-2">
            {serverEntries.map(([serverName, config]) => (
              <div
                key={serverName}
                className="flex items-center justify-between rounded-lg border border-border bg-background-secondary px-3 py-2.5"
              >
                <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-3">
                  <span className="text-sm font-medium text-foreground truncate">
                    {serverName}
                  </span>
                  <span className="text-xs text-foreground-muted truncate">
                    {config.url}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                    {getTransportLabel(config)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7 text-foreground-muted hover:text-error hover:bg-error/10"
                    onClick={() => removeServer(serverName)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-sm text-foreground-muted">
            No MCP servers configured.
          </div>
        )}

        {/* Add server form */}
        <form
          onSubmit={handleAddServer}
          className="space-y-3 pt-2 border-t border-border"
        >
          <p className="text-xs font-medium text-foreground-muted uppercase tracking-wider">
            Add Server
          </p>
          <Input
            placeholder="Server name (e.g. my-tools)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-input border-input-border text-foreground"
          />
          <Input
            placeholder="URL (e.g. https://mcp.example.com/sse)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="bg-input border-input-border text-foreground"
          />
          <Select value={transport} onValueChange={setTransport}>
            <SelectTrigger className="bg-input border-input-border text-foreground">
              <SelectValue placeholder="Transport (auto-detect)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto-detect</SelectItem>
              <SelectItem value="sse">SSE</SelectItem>
              <SelectItem value="streamable_http">Streamable HTTP</SelectItem>
              <SelectItem value="websocket">WebSocket</SelectItem>
            </SelectContent>
          </Select>

          {/* Headers */}
          <div className="space-y-2">
            <p className="text-xs text-foreground-muted">Headers (optional)</p>
            {Object.entries(headers).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <code className="bg-background-secondary px-1.5 py-0.5 rounded text-foreground flex-1 truncate">
                  {k}: {v}
                </code>
                <button
                  type="button"
                  onClick={() => handleRemoveHeader(k)}
                  className="text-foreground-muted hover:text-error"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                placeholder="Key"
                value={headerKey}
                onChange={(e) => setHeaderKey(e.target.value)}
                className="bg-input border-input-border text-foreground text-xs h-8 flex-1"
              />
              <Input
                placeholder="Value"
                value={headerValue}
                onChange={(e) => setHeaderValue(e.target.value)}
                className="bg-input border-input-border text-foreground text-xs h-8 flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="w-8 h-8 shrink-0 text-foreground-muted hover:text-accent"
                onClick={handleAddHeader}
                disabled={!headerKey.trim() || !headerValue.trim()}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={!canAdd}
            className="w-full bg-accent hover:bg-accent-hover text-accent-foreground font-medium"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Server
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
