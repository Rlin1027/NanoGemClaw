import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from './useApi';

interface GroupDetail {
    id: string;
    name: string;
    status: string;
    messageCount: number;
    activeTasks: number;
    persona?: string;
    requireTrigger?: boolean;
    enableWebSearch?: boolean;
    folder: string;
    tasks: any[];
    usage: {
        total_requests: number;
        total_duration_ms: number;
        avg_duration_ms: number;
        total_prompt_tokens: number;
        total_response_tokens: number;
    };
    errorState: {
        consecutiveFailures: number;
        lastError: string | null;
    } | null;
}

export function useGroupDetail(folder: string | undefined) {
    const [group, setGroup] = useState<GroupDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refetch = useCallback(async () => {
        if (!folder) return;
        setLoading(true);
        setError(null);
        try {
            const result = await apiFetch<GroupDetail>(`/api/groups/${folder}/detail`);
            setGroup(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [folder]);

    useEffect(() => {
        refetch();
    }, [refetch]);

    const updateSettings = useCallback(async (updates: {
        persona?: string;
        enableWebSearch?: boolean;
        requireTrigger?: boolean;
        name?: string;
    }) => {
        if (!folder) return;
        try {
            await apiFetch(`/api/groups/${folder}`, {
                method: 'PUT',
                body: JSON.stringify(updates),
            });
            await refetch();
        } catch (err) {
            throw err;
        }
    }, [folder, refetch]);

    return { group, loading, error, refetch, updateSettings };
}
