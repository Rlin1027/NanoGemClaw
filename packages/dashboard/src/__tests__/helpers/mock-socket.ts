import { vi } from 'vitest';

export function createMockSocket() {
    const listeners: Record<string, Function[]> = {};
    return {
        on: vi.fn((event: string, cb: Function) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(cb);
        }),
        off: vi.fn((event: string, cb?: Function) => {
            if (cb) {
                listeners[event] = (listeners[event] || []).filter(l => l !== cb);
            } else {
                delete listeners[event];
            }
        }),
        emit: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        connected: true,
        id: 'test-socket-id',
        __simulateEvent: (event: string, ...args: any[]) => {
            (listeners[event] || []).forEach(cb => cb(...args));
        },
    };
}
