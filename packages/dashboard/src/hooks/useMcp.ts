import { useCallback, useEffect, useRef } from 'react';
import { apiFetch, useApiQuery } from './useApi';

export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    enabled: boolean;
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

    const refetchingRef = useRef(false);
    const safeRefetch = useCallback(async () => {
        if (refetchingRef.current) return;
        refetchingRef.current = true;
        try {
            await refetch();
        } finally {
            refetchingRef.current = false;
        }
    }, [refetch]);

    const addServer = useCallback(async (payload: AddMcpServerPayload) => {
        await apiFetch('/api/mcp/servers', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        await safeRefetch();
    }, [safeRefetch]);

    const updateServer = useCallback(async (id: string, updates: Partial<AddMcpServerPayload>) => {
        await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        });
        await safeRefetch();
    }, [safeRefetch]);

    const removeServer = useCallback(async (id: string) => {
        await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        await safeRefetch();
    }, [safeRefetch]);

    const reconnectServer = useCallback(async (id: string) => {
        await apiFetch(`/api/mcp/servers/${encodeURIComponent(id)}/reconnect`, {
            method: 'POST',
        });
        await safeRefetch();
    }, [safeRefetch]);

    const updateToolPermission = useCallback(async (serverId: string, toolName: string, enabled: boolean) => {
        const server = (data ?? []).find(s => s.id === serverId);
        const currentAllowed = (server?.tools ?? []).filter(t => t.enabled).map(t => t.name);
        const allowedTools = enabled
            ? [...currentAllowed.filter(n => n !== toolName), toolName]
            : currentAllowed.filter(n => n !== toolName);
        await apiFetch(`/api/mcp/servers/${encodeURIComponent(serverId)}/tools`, {
            method: 'PATCH',
            body: JSON.stringify({ allowedTools }),
        });
        await safeRefetch();
    }, [data, safeRefetch]);

    // Polling every 5s for status updates
    const refetchRef = useRef(refetch);
    refetchRef.current = refetch;
    const abortRef = useRef<AbortController | null>(null);
    useEffect(() => {
        const interval = setInterval(() => {
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            refetchRef.current();
        }, 5000);
        return () => {
            clearInterval(interval);
            abortRef.current?.abort();
            abortRef.current = null;
        };
    }, []);

    return {
        servers,
        isLoading,
        error,
        refetch: safeRefetch,
        addServer,
        updateServer,
        removeServer,
        reconnectServer,
        updateToolPermission,
    };
}
