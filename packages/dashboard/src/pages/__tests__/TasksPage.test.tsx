import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetchSuccess } from '../../__tests__/helpers/mock-fetch';
import { createMockSocket } from '../../__tests__/helpers/mock-socket';

const mockSocket = createMockSocket();

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => mockSocket),
}));

const sampleTasks = [
    {
        id: 'task-1',
        group_folder: 'group-1',
        prompt: 'Send weekly digest',
        schedule_type: 'cron',
        schedule_value: '0 9 * * 1',
        context_mode: 'isolated',
        status: 'active',
        next_run: null,
        last_run: null,
        created_at: '2024-01-01T00:00:00Z',
    },
];

describe('TasksPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetchSuccess(sampleTasks));
    });

    it('renders Scheduled Tasks heading', async () => {
        const { TasksPage } = await import('../TasksPage');
        render(<TasksPage />);
        expect(screen.getByText('Scheduled Tasks')).toBeInTheDocument();
    });

    it('shows loading state initially', async () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
        const { TasksPage } = await import('../TasksPage');
        render(<TasksPage />);
        expect(screen.getByText('Loading tasks...')).toBeInTheDocument();
    });

    it('renders task list after load', async () => {
        const { TasksPage } = await import('../TasksPage');
        render(<TasksPage />);
        await waitFor(() => {
            expect(screen.getByText('Send weekly digest')).toBeInTheDocument();
        });
    });

    it('New Task button is present', async () => {
        const { TasksPage } = await import('../TasksPage');
        render(<TasksPage />);
        expect(screen.getByRole('button', { name: /New Task/i })).toBeInTheDocument();
    });

    it('clicking New Task button opens the task form modal', async () => {
        const user = userEvent.setup();
        const { TasksPage } = await import('../TasksPage');
        render(<TasksPage />);
        await user.click(screen.getByRole('button', { name: /New Task/i }));
        expect(screen.getByText('Create Scheduled Task')).toBeInTheDocument();
    });

    it('renders group and status filter dropdowns', async () => {
        const { TasksPage } = await import('../TasksPage');
        render(<TasksPage />);
        expect(screen.getByRole('option', { name: 'All Groups' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'All Statuses' })).toBeInTheDocument();
    });
});
