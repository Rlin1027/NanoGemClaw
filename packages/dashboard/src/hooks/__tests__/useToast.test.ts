import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Re-import fresh module state per test by using dynamic imports and resetting
// the module registry. The toast module uses global singleton state, so we
// isolate by resetting between tests via the module's own cleanup mechanism.

describe('showToast and useToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Advance time between tests so Date.now() produces different IDs
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.runAllTimers();
        vi.useRealTimers();
    });

    it('showToast creates a toast visible to useToast consumers', async () => {
        const { showToast, useToast } = await import('../useToast');
        const { result } = renderHook(() => useToast());
        act(() => { showToast('Hello world', 'success'); });
        const toast = result.current.toasts.find(t => t.message === 'Hello world');
        expect(toast).toBeDefined();
        expect(toast?.type).toBe('success');
    });

    it('defaults toast type to error', async () => {
        const { showToast, useToast } = await import('../useToast');
        const { result } = renderHook(() => useToast());
        act(() => { showToast('Error message'); });
        const toast = result.current.toasts.find(t => t.message === 'Error message');
        expect(toast?.type).toBe('error');
    });

    it('creates info type toast', async () => {
        const { showToast, useToast } = await import('../useToast');
        const { result } = renderHook(() => useToast());
        act(() => { showToast('Info message', 'info'); });
        const toast = result.current.toasts.find(t => t.message === 'Info message');
        expect(toast?.type).toBe('info');
    });

    it('auto-dismisses toast after 5 seconds', async () => {
        const { showToast, useToast } = await import('../useToast');
        const { result } = renderHook(() => useToast());
        act(() => { showToast('Auto dismiss', 'success'); });
        expect(result.current.toasts.some(t => t.message === 'Auto dismiss')).toBe(true);
        act(() => { vi.advanceTimersByTime(5000); });
        expect(result.current.toasts.some(t => t.message === 'Auto dismiss')).toBe(false);
    });

    it('does not dismiss before 5 seconds', async () => {
        const { showToast, useToast } = await import('../useToast');
        const { result } = renderHook(() => useToast());
        act(() => { showToast('Not yet dismissed', 'info'); });
        act(() => { vi.advanceTimersByTime(4999); });
        expect(result.current.toasts.some(t => t.message === 'Not yet dismissed')).toBe(true);
    });

    it('manual dismiss removes a specific toast', async () => {
        const { showToast, useToast } = await import('../useToast');
        const { result } = renderHook(() => useToast());
        act(() => { showToast('Dismiss me', 'error'); });
        const toast = result.current.toasts.find(t => t.message === 'Dismiss me');
        expect(toast).toBeDefined();
        act(() => { result.current.dismiss(toast!.id); });
        expect(result.current.toasts.some(t => t.message === 'Dismiss me')).toBe(false);
    });

    it('dismissing one toast does not remove others', async () => {
        const { showToast, useToast } = await import('../useToast');
        const { result } = renderHook(() => useToast());
        act(() => { showToast('Toast A', 'info'); });
        // Advance time so next toast gets a different ID
        vi.setSystemTime(new Date('2024-01-01T00:00:01.000Z'));
        act(() => { showToast('Toast B', 'success'); });
        const toastA = result.current.toasts.find(t => t.message === 'Toast A');
        expect(toastA).toBeDefined();
        act(() => { result.current.dismiss(toastA!.id); });
        expect(result.current.toasts.some(t => t.message === 'Toast B')).toBe(true);
        expect(result.current.toasts.some(t => t.message === 'Toast A')).toBe(false);
    });

    it('each toast has a unique id', async () => {
        const { showToast, useToast } = await import('../useToast');
        const { result } = renderHook(() => useToast());
        act(() => { showToast('First', 'info'); });
        // Advance clock so Date.now() is different
        vi.setSystemTime(new Date('2024-01-01T00:00:01.000Z'));
        act(() => { showToast('Second', 'info'); });
        const msgs = ['First', 'Second'];
        const matched = result.current.toasts.filter(t => msgs.includes(t.message));
        const ids = matched.map(t => t.id);
        expect(ids.length).toBe(2);
        expect(new Set(ids).size).toBe(2);
    });

    it('showToast is re-exported from useToast return value', async () => {
        const { useToast } = await import('../useToast');
        const { result } = renderHook(() => useToast());
        expect(typeof result.current.showToast).toBe('function');
    });
});
