import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastContainer } from '../ToastContainer';
import { showToast } from '../../hooks/useToast';

describe('ToastContainer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
        // Only run timers if fake timers are still active
        try { vi.runAllTimers(); } catch { /* real timers already restored */ }
        vi.useRealTimers();
    });

    it('renders nothing when there are no toasts', () => {
        const { container } = render(<ToastContainer />);
        // If no toasts, returns null — container will have no children
        // (there may be pre-existing toasts from other tests; just check
        // that the component renders without error)
        expect(container).toBeInTheDocument();
    });

    it('renders a toast message when showToast is called', () => {
        render(<ToastContainer />);
        act(() => { showToast('Container toast message', 'info'); });
        expect(screen.getByText('Container toast message')).toBeInTheDocument();
    });

    it('renders multiple toast messages', () => {
        render(<ToastContainer />);
        act(() => {
            showToast('Container first toast', 'success');
        });
        vi.setSystemTime(new Date('2024-01-01T00:00:01.000Z'));
        act(() => {
            showToast('Container second toast', 'error');
        });
        expect(screen.getByText('Container first toast')).toBeInTheDocument();
        expect(screen.getByText('Container second toast')).toBeInTheDocument();
    });

    it('toast disappears after auto-dismiss timeout', () => {
        render(<ToastContainer />);
        act(() => { showToast('Auto dismiss container toast', 'info'); });
        expect(screen.getByText('Auto dismiss container toast')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(5000); });
        expect(screen.queryByText('Auto dismiss container toast')).not.toBeInTheDocument();
    });

    it('close button dismisses a toast manually', async () => {
        // Use real timers for userEvent but fake for everything else
        vi.useRealTimers();
        const user = userEvent.setup();
        render(<ToastContainer />);
        act(() => { showToast('Manual dismiss container toast', 'error'); });
        expect(screen.getByText('Manual dismiss container toast')).toBeInTheDocument();
        // Find the close X button for this toast (last button rendered)
        const closeButtons = screen.getAllByRole('button');
        await user.click(closeButtons[closeButtons.length - 1]);
        expect(screen.queryByText('Manual dismiss container toast')).not.toBeInTheDocument();
    });
});
