import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createMockSocket } from '../../__tests__/helpers/mock-socket';

const mockSocket = createMockSocket();

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => mockSocket),
}));

describe('useSocket', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset mock socket state
        mockSocket.connected = true;
    });

    it('initializes with isConnected false before connect event', async () => {
        const { useSocket } = await import('../useSocket');
        const { result } = renderHook(() => useSocket());
        expect(result.current.isConnected).toBe(false);
    });

    it('sets isConnected true on connect event', async () => {
        const { useSocket } = await import('../useSocket');
        const { result } = renderHook(() => useSocket());
        act(() => {
            mockSocket.__simulateEvent('connect');
        });
        expect(result.current.isConnected).toBe(true);
    });

    it('sets isConnected false on disconnect event', async () => {
        const { useSocket } = await import('../useSocket');
        const { result } = renderHook(() => useSocket());
        act(() => {
            mockSocket.__simulateEvent('connect');
        });
        act(() => {
            mockSocket.__simulateEvent('disconnect');
        });
        expect(result.current.isConnected).toBe(false);
    });

    it('initializes with empty groups array', async () => {
        const { useSocket } = await import('../useSocket');
        const { result } = renderHook(() => useSocket());
        expect(result.current.groups).toEqual([]);
    });

    it('updates groups on groups:update event', async () => {
        const { useSocket } = await import('../useSocket');
        const { result } = renderHook(() => useSocket());
        const groupData = [{ id: 'g1', name: 'Group 1', status: 'active', messageCount: 10, activeTasks: 2 }];
        act(() => {
            mockSocket.__simulateEvent('groups:update', groupData);
        });
        expect(result.current.groups).toEqual(groupData);
    });

    it('initializes with empty logs array', async () => {
        const { useSocket } = await import('../useSocket');
        const { result } = renderHook(() => useSocket());
        expect(result.current.logs).toEqual([]);
    });

    it('populates logs on logs:history event', async () => {
        const { useSocket } = await import('../useSocket');
        const { result } = renderHook(() => useSocket());
        const history = [
            { id: 1, timestamp: '2024-01-01T10:00:00Z', level: 'info', message: 'Server started' },
        ];
        act(() => {
            mockSocket.__simulateEvent('logs:history', history);
        });
        expect(result.current.logs.length).toBe(1);
        expect(result.current.logs[0]).toContain('Server started');
    });

    it('appends logs on logs:entry event', async () => {
        const { useSocket } = await import('../useSocket');
        const { result } = renderHook(() => useSocket());
        act(() => {
            mockSocket.__simulateEvent('logs:entry', { id: 1, timestamp: '2024-01-01T10:00:00Z', level: 'info', message: 'Entry 1' });
        });
        act(() => {
            mockSocket.__simulateEvent('logs:entry', { id: 2, timestamp: '2024-01-01T10:00:01Z', level: 'warn', message: 'Entry 2' });
        });
        expect(result.current.logs.length).toBe(2);
    });

    it('returns socket instance', async () => {
        const { useSocket } = await import('../useSocket');
        const { result } = renderHook(() => useSocket());
        expect(result.current.socket).not.toBeNull();
    });

    it('calls disconnect on unmount', async () => {
        const { useSocket } = await import('../useSocket');
        const { unmount } = renderHook(() => useSocket());
        unmount();
        expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('registers connect and disconnect listeners', async () => {
        const { useSocket } = await import('../useSocket');
        renderHook(() => useSocket());
        const registeredEvents = mockSocket.on.mock.calls.map((c: any[]) => c[0]);
        expect(registeredEvents).toContain('connect');
        expect(registeredEvents).toContain('disconnect');
    });
});
