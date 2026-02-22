import { useState, useCallback, useRef } from 'react';
import { useApiQuery, useApiMutation, apiFetch } from './useApi';

export interface KnowledgeDoc {
    id: number;
    group_folder: string;
    filename: string;
    title: string;
    content: string;
    size_chars: number;
    created_at: string;
    updated_at: string;
}

export function useKnowledgeDocs(groupFolder: string) {
    return useApiQuery<KnowledgeDoc[]>(`/api/groups/${groupFolder}/knowledge`);
}

export function useCreateKnowledgeDoc(groupFolder: string) {
    return useApiMutation<KnowledgeDoc, { filename: string; title: string; content: string }>(
        `/api/groups/${groupFolder}/knowledge`,
        'POST'
    );
}

export function useUpdateKnowledgeDoc(groupFolder: string, docId: number) {
    return useApiMutation<KnowledgeDoc, { title: string; content: string }>(
        `/api/groups/${groupFolder}/knowledge/${docId}`,
        'PUT'
    );
}

export function useDeleteKnowledgeDoc(groupFolder: string, docId: number) {
    return useApiMutation<{ success: boolean }, void>(
        `/api/groups/${groupFolder}/knowledge/${docId}`,
        'DELETE'
    );
}

export interface KnowledgeSearchResult {
    id: number;
    title: string;
    filename: string;
    snippet: string;
    rank: number;
}

export function useKnowledgeSearch(groupFolder: string) {
    const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    const search = useCallback((query: string) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        if (!query || query.length < 3 || !groupFolder) {
            setResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        debounceRef.current = setTimeout(async () => {
            try {
                const data = await apiFetch<KnowledgeSearchResult[]>(
                    `/api/groups/${groupFolder}/knowledge/search?q=${encodeURIComponent(query)}`
                );
                setResults(data);
            } catch {
                setResults([]);
            } finally {
                setIsSearching(false);
            }
        }, 300);
    }, [groupFolder]);

    const clearSearch = useCallback(() => {
        setResults([]);
        setIsSearching(false);
    }, []);

    return { results, isSearching, search, clearSearch };
}
