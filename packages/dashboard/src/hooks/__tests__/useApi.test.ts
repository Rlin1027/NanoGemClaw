import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { apiFetch, useApiQuery, useApiMutation } from '../useApi';
import { mockFetchSuccess, mockFetchError, mockFetchNetworkError } from '../../__tests__/helpers/mock-fetch';

describe('apiFetch', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetchSuccess({ items: [1, 2, 3] }));
        (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('test-code');
    });

    it('returns data from successful response', async () => {
        const result = await apiFetch<{ items: number[] }>('/api/test');
        expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('adds x-access-code header from localStorage', async () => {
        await apiFetch('/api/test');
        const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
        expect(callHeaders['x-access-code']).toBe('test-code');
    });

    it('uses empty string when no access code in localStorage', async () => {
        (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
        await apiFetch('/api/test');
        const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
        expect(callHeaders['x-access-code']).toBe('');
    });

    it('adds Content-Type application/json header', async () => {
        await apiFetch('/api/test');
        const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
        expect(callHeaders['Content-Type']).toBe('application/json');
    });

    it('throws on non-ok response', async () => {
        vi.stubGlobal('fetch', mockFetchError(401, 'Unauthorized'));
        await expect(apiFetch('/api/test')).rejects.toThrow('API Error: Unauthorized');
    });

    it('throws on network error', async () => {
        vi.stubGlobal('fetch', mockFetchNetworkError());
        await expect(apiFetch('/api/test')).rejects.toThrow('Failed to fetch');
    });

    it('returns json directly when no data wrapper', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ message: 'hello' }),
        }));
        const result = await apiFetch<{ message: string }>('/api/test');
        expect(result).toEqual({ message: 'hello' });
    });

    it('merges custom options with defaults', async () => {
        await apiFetch('/api/test', { method: 'POST', body: '{}' });
        const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call[1].method).toBe('POST');
        expect(call[1].body).toBe('{}');
    });

    it('allows overriding headers', async () => {
        await apiFetch('/api/test', { headers: { 'x-custom': 'value' } });
        const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
        expect(callHeaders['x-custom']).toBe('value');
    });
});

describe('useApiQuery', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetchSuccess([{ id: '1', name: 'Test' }]));
    });

    it('starts in loading state', () => {
        const { result } = renderHook(() => useApiQuery('/api/items'));
        expect(result.current.isLoading).toBe(true);
    });

    it('returns data after successful fetch', async () => {
        const { result } = renderHook(() => useApiQuery<{ id: string; name: string }[]>('/api/items'));
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.data).toEqual([{ id: '1', name: 'Test' }]);
        expect(result.current.error).toBeNull();
    });

    it('returns error on failed fetch', async () => {
        vi.stubGlobal('fetch', mockFetchError(500, 'Internal Server Error'));
        const { result } = renderHook(() => useApiQuery('/api/items'));
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.data).toBeNull();
    });

    it('returns error on network failure', async () => {
        vi.stubGlobal('fetch', mockFetchNetworkError());
        const { result } = renderHook(() => useApiQuery('/api/items'));
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.error).toBeInstanceOf(Error);
    });

    it('refetch re-runs the query', async () => {
        const { result } = renderHook(() => useApiQuery('/api/items'));
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        const fetchMock = fetch as ReturnType<typeof vi.fn>;
        const callsBefore = fetchMock.mock.calls.length;
        await result.current.refetch();
        expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
});

describe('useApiMutation', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetchSuccess({ created: true }));
        (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('test-code');
    });

    it('starts not loading', () => {
        const { result } = renderHook(() => useApiMutation('/api/items'));
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('returns data on successful mutation', async () => {
        const { result } = renderHook(() => useApiMutation<{ created: boolean }, { name: string }>('/api/items'));
        let response: { created: boolean } | null = null;
        await waitFor(async () => {
            response = await result.current.mutate({ name: 'Test' });
        });
        expect(response).toEqual({ created: true });
    });

    it('sends POST by default', async () => {
        const { result } = renderHook(() => useApiMutation('/api/items'));
        await result.current.mutate({});
        const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call[1].method).toBe('POST');
    });

    it('sends PUT when method is PUT', async () => {
        const { result } = renderHook(() => useApiMutation('/api/items', 'PUT'));
        await result.current.mutate({});
        const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call[1].method).toBe('PUT');
    });

    it('sends DELETE when method is DELETE', async () => {
        const { result } = renderHook(() => useApiMutation('/api/items', 'DELETE'));
        await result.current.mutate({});
        const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call[1].method).toBe('DELETE');
    });

    it('adds x-access-code header', async () => {
        const { result } = renderHook(() => useApiMutation('/api/items'));
        await result.current.mutate({});
        const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
        expect(callHeaders['x-access-code']).toBe('test-code');
    });

    it('sets error state on failure', async () => {
        vi.stubGlobal('fetch', mockFetchError(400, 'Bad Request'));
        const { result } = renderHook(() => useApiMutation('/api/items'));
        await waitFor(async () => {
            await result.current.mutate({});
        });
        expect(result.current.error).toBeInstanceOf(Error);
    });

    it('returns null on failure', async () => {
        vi.stubGlobal('fetch', mockFetchError(400, 'Bad Request'));
        const { result } = renderHook(() => useApiMutation('/api/items'));
        let response: unknown = 'sentinel';
        await waitFor(async () => {
            response = await result.current.mutate({});
        });
        expect(response).toBeNull();
    });
});
