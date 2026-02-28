import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || window.location.origin;

export async function apiFetch<T>(
    url: string,
    options?: RequestInit
): Promise<T> {
    const accessCode = localStorage.getItem('nanogemclaw_access_code') || '';
    const res = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'x-access-code': accessCode,
            ...options?.headers,
        },
    });
    if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
    const json = await res.json();
    return (json.data ?? json) as T;
}

interface UseApiQueryResult<T> {
    data: T | null;
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
}

export function useApiQuery<T>(endpoint: string): UseApiQueryResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        controllerRef.current = controller;
        setIsLoading(true);
        (async () => {
            try {
                const result = await apiFetch<T>(endpoint, { signal: controller.signal });
                setData(result);
                setError(null);
            } catch (err) {
                if (!controller.signal.aborted) {
                    setError(err instanceof Error ? err : new Error('Unknown error'));
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            }
        })();
        return () => controller.abort();
    }, [endpoint]);

    const refetch = useCallback(async () => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setIsLoading(true);
        try {
            const result = await apiFetch<T>(endpoint, { signal: controller.signal });
            setData(result);
            setError(null);
        } catch (err) {
            if (!controller.signal.aborted) {
                setError(err instanceof Error ? err : new Error('Unknown error'));
            }
        } finally {
            if (!controller.signal.aborted) {
                setIsLoading(false);
            }
        }
    }, [endpoint]);

    return { data, isLoading, error, refetch };
}

interface UseApiMutationResult<T, V> {
    mutate: (variables: V) => Promise<T | null>;
    isLoading: boolean;
    error: Error | null;
}

export function useApiMutation<T, V>(
    endpoint: string,
    method: 'POST' | 'PUT' | 'DELETE' = 'POST'
): UseApiMutationResult<T, V> {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const mutate = async (variables: V) => {
        setIsLoading(true);
        setError(null);
        try {
            const accessCode = localStorage.getItem('nanogemclaw_access_code') || '';
            const res = await fetch(`${API_BASE}${endpoint}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'x-access-code': accessCode
                },
                body: JSON.stringify(variables),
            });
            if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
            const json = await res.json();
            return (json.data ?? json) as T;
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Unknown error'));
            return null;
        } finally {
            setIsLoading(false);
        }
    };

    return { mutate, isLoading, error };
}
