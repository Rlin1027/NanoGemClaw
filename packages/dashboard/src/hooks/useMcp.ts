import { useCallback, useEffect, useRef } from 'react';
import { apiFetch, useApiQuery } from './useApi';

export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

export interface McpServer {
    id: string;
    name: string;
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    url?: string;
    permission: 'main' | 'any';
    enabled: boolean;
    status: 'connected' | 'disconnected' | 'error';
    toolCount: number;
    tools: McpTool[];
    errorMessage?: string;
}

export interface AddMcpServerPayload {
    id: string;
    name: string;
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    url?: string;
    permission: 'main' | 'any';
    enabled: boolean;
}

export function useMcp() {
    const { data, isLoading, error, refetch } = useApiQuery<McpServer[]>('/api/mcp/servers');

    const servers = data ?? [];

    const addServer = useCallback(async (payload: AddMcpServerPayload) => {
        await apiFetch('/api/mcp/servers', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        await refetch();
    }, [refetch]);

    const updateServer = useCallback(async (id: string, updates: Partial<AddMcpServerPayload>) => {
        await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        });
        await refetch();
    }, [refetch]);

    const removeServer = useCallback(async (id: string) => {
        await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        await refetch();
    }, [refetch]);

    const reconnectServer = useCallback(async (id: string) => {
        await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}/reconnect`, {
            method: 'POST',
        });
        await refetch();
    }, [refetch]);

    // Polling every 5s for status updates
    const refetchRef = useRef(refetch);
    refetchRef.current = refetch;
    useEffect(() => {
        const interval = setInterval(() => {
            refetchRef.current();
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    return {
        servers,
        isLoading,
        error,
        refetch,
        addServer,
        updateServer,
        removeServer,
        reconnectServer,
    };
}
