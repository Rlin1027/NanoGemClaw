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
    if (filters.groupFolder) params.set('group', filters.groupFolder);
    if (filters.injectionOnly) params.set('injection', 'true');
    params.set('page', String(filters.page ?? 1));
    params.set('limit', String(filters.pageSize ?? 50));
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

interface ToolCallStatsRaw {
    total_calls: number;
    unique_tools: number;
    avg_duration_ms: number | null;
    injection_count: number;
    by_status: Array<{ result_status: string; count: number }>;
    by_tool: Array<{ tool_name: string; count: number }>;
}

function mapStats(raw: ToolCallStatsRaw | null): ToolCallStats {
    if (!raw) return { totalCalls: 0, successRate: 0, injectionAlerts: 0 };
    const successCount = raw.by_status.find(s => s.result_status === 'success')?.count ?? 0;
    return {
        totalCalls: raw.total_calls,
        successRate: raw.total_calls > 0 ? successCount / raw.total_calls : 0,
        injectionAlerts: raw.injection_count,
    };
}

export function useToolCallStats() {
    const { data, isLoading, error, refetch } = useApiQuery<ToolCallStatsRaw>('/api/tool-calls/stats');
    return {
        stats: mapStats(data ?? null),
        isLoading,
        error,
        refetch,
    };
}
