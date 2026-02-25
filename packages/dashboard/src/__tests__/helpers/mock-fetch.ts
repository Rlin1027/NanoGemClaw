import { vi } from 'vitest';

export function mockFetchSuccess<T>(data: T) {
    return vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data }),
        text: () => Promise.resolve(JSON.stringify({ data })),
    });
}

export function mockFetchError(status: number, message: string) {
    return vi.fn().mockResolvedValue({
        ok: false,
        status,
        statusText: message,
        json: () => Promise.resolve({ error: message }),
        text: () => Promise.resolve(JSON.stringify({ error: message })),
    });
}

export function mockFetchNetworkError() {
    return vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
}
