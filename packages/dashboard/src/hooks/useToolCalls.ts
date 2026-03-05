import { useApiQuery } from './useApi';

export interface ToolCallRecord {
    id: string;
    timestamp: string;
    groupFolder: string;
    toolName: string;
    status: 'success' | 'error' | 'blocked';
    durationMs: number;
    injectionDetected: boolean;
    errorMessage?: string;
}

export interface ToolCallStats {
    totalCalls: number;
    successRate: number;
    injectionAlerts: number;
}

export interface ToolCallFilters {
    groupFolder?: string;
    toolName?: string;
    injectionOnly?: boolean;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
}

export interface ToolCallsResult {
    records: ToolCallRecord[];
    total: number;
    page: number;
    pageSize: number;
}

function buildQuery(filters: ToolCallFilters): string {
    const params = new URLSearchParams();
    if (filters.groupFolder) params.set('groupFolder', filters.groupFolder);
    if (filters.toolName) params.set('toolName', filters.toolName);
    if (filters.injectionOnly) params.set('injectionOnly', 'true');
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    params.set('page', String(filters.page ?? 1));
    params.set('pageSize', String(filters.pageSize ?? 50));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

export function useToolCalls(filters: ToolCallFilters) {
    const query = buildQuery(filters);
    const { data, isLoading, error, refetch } = useApiQuery<ToolCallsResult>(
        `/api/tool-calls${query}`,
    );

    return {
        records: data?.records ?? [],
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? 50,
        isLoading,
        error,
        refetch,
    };
}

export function useToolCallStats() {
    const { data, isLoading, error, refetch } = useApiQuery<ToolCallStats>('/api/tool-calls/stats');
    return {
        stats: data ?? { totalCalls: 0, successRate: 0, injectionAlerts: 0 },
        isLoading,
        error,
        refetch,
    };
}
