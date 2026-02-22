import { useState, useCallback } from 'react';
import { apiFetch } from './useApi';

export interface SearchResult {
    id: number;
    chatJid: string;
    sender: string;
    content: string;
    timestamp: string;
    isFromMe: boolean;
    snippet: string;
    rank: number;
}

interface SearchResponse {
    results: SearchResult[];
    total: number;
}

export function useSearch() {
    const [results, setResults] = useState<SearchResult[]>([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    const search = useCallback(async (q: string, group?: string, limit = 20, offset = 0) => {
        if (!q.trim()) {
            setResults([]);
            setTotal(0);
            return;
        }
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
            if (group) params.set('group', group);
            const data = await apiFetch<SearchResponse>(`/api/search?${params}`);
            setResults(data.results);
            setTotal(data.total);
        } catch {
            setResults([]);
            setTotal(0);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const clear = useCallback(() => {
        setResults([]);
        setTotal(0);
    }, []);

    return { search, results, total, isLoading, clear };
}
