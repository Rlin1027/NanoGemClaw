import { useCallback, useState } from 'react';
import { useApiQuery, apiFetch } from './useApi';

export type PersonaCategory =
    | 'general'
    | 'technical'
    | 'productivity'
    | 'creative'
    | 'learning'
    | 'finance'
    | 'lifestyle';

export interface PersonaWithMeta {
    name: string;
    description: string;
    systemPrompt: string;
    category?: PersonaCategory;
    builtIn: boolean;
}

export function usePersonas() {
    const { data, isLoading: loading, error, refetch } = useApiQuery<Record<string, PersonaWithMeta>>('/api/personas');
    return { data, loading, error, refetch };
}

export interface CreatePersonaPayload {
    key: string;
    name: string;
    description?: string;
    systemPrompt: string;
    category?: PersonaCategory;
}

export function useCreatePersona() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const mutate = useCallback(async (payload: CreatePersonaPayload): Promise<{ key: string } | null> => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await apiFetch<{ key: string }>('/api/personas', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            return result;
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Unknown error'));
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    return { mutate, isLoading, error };
}

export function useDeletePersona() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const mutate = useCallback(async (key: string): Promise<boolean> => {
        setIsLoading(true);
        setError(null);
        try {
            await apiFetch(`/api/personas/${encodeURIComponent(key)}`, {
                method: 'DELETE',
            });
            return true;
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Unknown error'));
            return false;
        } finally {
            setIsLoading(false);
        }
    }, []);

    return { mutate, isLoading, error };
}
