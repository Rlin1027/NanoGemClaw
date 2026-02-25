import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskList } from '../TaskList';
import { mockFetchSuccess } from '../../__tests__/helpers/mock-fetch';

interface TaskShape {
    id: string;
    group_folder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    context_mode: string;
    status: string;
    next_run: string | null;
    last_run: string | null;
    created_at: string;
}

const makeTasks = (overrides: Partial<TaskShape>[] = [{}]): TaskShape[] =>
    overrides.map((o, i) => ({
        id: `task-${i + 1}`,
        group_folder: 'group-1',
        prompt: `Task prompt ${i + 1}`,
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
        context_mode: 'isolated',
        status: 'active',
        next_run: null,
        last_run: null,
        created_at: '2024-01-01T00:00:00Z',
        ...o,
    }));

const baseTasks = makeTasks([{}]);

describe('TaskList', () => {
    const onRefresh = vi.fn();
    const onEdit = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetchSuccess([]));
        vi.stubGlobal('confirm', vi.fn(() => true));
    });

    it('shows empty state when no tasks', () => {
        render(<TaskList tasks={[]} onRefresh={onRefresh} />);
        expect(screen.getByText('No tasks found')).toBeInTheDocument();
    });

    it('renders task prompts', () => {
        render(<TaskList tasks={makeTasks([{ prompt: 'Send daily report' }])} onRefresh={onRefresh} />);
        expect(screen.getByText('Send daily report')).toBeInTheDocument();
    });

    it('renders multiple tasks', () => {
        const tasks = makeTasks([{ prompt: 'Task A' }, { prompt: 'Task B' }]);
        render(<TaskList tasks={tasks} onRefresh={onRefresh} />);
        expect(screen.getByText('Task A')).toBeInTheDocument();
        expect(screen.getByText('Task B')).toBeInTheDocument();
    });

    it('shows active status badge', () => {
        render(<TaskList tasks={makeTasks([{ status: 'active' }])} onRefresh={onRefresh} />);
        expect(screen.getByText('active')).toBeInTheDocument();
    });

    it('shows paused status badge', () => {
        render(<TaskList tasks={makeTasks([{ status: 'paused' }])} onRefresh={onRefresh} />);
        expect(screen.getByText('paused')).toBeInTheDocument();
    });

    it('shows pause button for active tasks', () => {
        render(<TaskList tasks={makeTasks([{ status: 'active' }])} onRefresh={onRefresh} />);
        expect(screen.getByTitle('Pause')).toBeInTheDocument();
    });

    it('shows resume button for paused tasks', () => {
        render(<TaskList tasks={makeTasks([{ status: 'paused' }])} onRefresh={onRefresh} />);
        expect(screen.getByTitle('Resume')).toBeInTheDocument();
    });

    it('shows delete button', () => {
        render(<TaskList tasks={baseTasks} onRefresh={onRefresh} />);
        expect(screen.getByTitle('Delete')).toBeInTheDocument();
    });

    it('shows edit button when onEdit is provided', () => {
        render(<TaskList tasks={baseTasks} onRefresh={onRefresh} onEdit={onEdit} />);
        expect(screen.getByTitle('Edit')).toBeInTheDocument();
    });

    it('does not show edit button when onEdit is not provided', () => {
        render(<TaskList tasks={baseTasks} onRefresh={onRefresh} />);
        expect(screen.queryByTitle('Edit')).not.toBeInTheDocument();
    });

    it('clicking edit button calls onEdit with the task', async () => {
        const user = userEvent.setup();
        const task = makeTasks([{ prompt: 'Editable task' }])[0];
        render(<TaskList tasks={[task]} onRefresh={onRefresh} onEdit={onEdit} />);
        await user.click(screen.getByTitle('Edit'));
        expect(onEdit).toHaveBeenCalledWith(task);
    });

    it('clicking task row expands it', async () => {
        const user = userEvent.setup();
        vi.stubGlobal('fetch', mockFetchSuccess([]));
        render(<TaskList tasks={makeTasks([{ prompt: 'Expandable task' }])} onRefresh={onRefresh} />);
        await user.click(screen.getByText('Expandable task'));
        await waitFor(() => {
            expect(screen.getByText('Task Details')).toBeInTheDocument();
        });
    });

    it('clicking expanded row collapses it', async () => {
        const user = userEvent.setup();
        vi.stubGlobal('fetch', mockFetchSuccess([]));
        render(<TaskList tasks={makeTasks([{ prompt: 'Toggle task' }])} onRefresh={onRefresh} />);
        // Click the row container (the flex div) rather than the text which appears twice when expanded
        const row = screen.getByText('Toggle task').closest('[class*="cursor-pointer"]') as HTMLElement;
        await user.click(row);
        await waitFor(() => expect(screen.getByText('Task Details')).toBeInTheDocument());
        await user.click(row);
        await waitFor(() => expect(screen.queryByText('Task Details')).not.toBeInTheDocument());
    });

    it('delete with confirm calls API and onRefresh', async () => {
        const user = userEvent.setup();
        render(<TaskList tasks={baseTasks} onRefresh={onRefresh} />);
        await user.click(screen.getByTitle('Delete'));
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
        expect(fetch).toHaveBeenCalled();
    });

    it('delete without confirm does not call API', async () => {
        vi.stubGlobal('confirm', vi.fn(() => false));
        const user = userEvent.setup();
        render(<TaskList tasks={baseTasks} onRefresh={onRefresh} />);
        await user.click(screen.getByTitle('Delete'));
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('pause button calls status API and refreshes', async () => {
        const user = userEvent.setup();
        render(<TaskList tasks={makeTasks([{ status: 'active' }])} onRefresh={onRefresh} />);
        await user.click(screen.getByTitle('Pause'));
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    });

    it('resume button calls status API and refreshes', async () => {
        const user = userEvent.setup();
        render(<TaskList tasks={makeTasks([{ status: 'paused' }])} onRefresh={onRefresh} />);
        await user.click(screen.getByTitle('Resume'));
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    });
});
