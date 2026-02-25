import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskFormModal } from '../TaskFormModal';
import { mockFetchSuccess, mockFetchError } from '../../__tests__/helpers/mock-fetch';

const defaultGroups = [
    { id: 'group-1', name: 'Group One' },
    { id: 'group-2', name: 'Group Two' },
];

const editTask = {
    id: 'task-123',
    group_folder: 'group-1',
    prompt: 'Existing prompt text',
    schedule_type: 'cron',
    schedule_value: '0 9 * * *',
    context_mode: 'isolated',
};

describe('TaskFormModal — create mode', () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetchSuccess({ id: 'new-task' }));
    });

    it('renders Create Scheduled Task heading', () => {
        render(<TaskFormModal groups={defaultGroups} onClose={onClose} onCreated={onCreated} />);
        // heading and button both use t('createTask') = "Create Task"; query by role
        expect(screen.getByRole('heading', { name: 'Create Task' })).toBeInTheDocument();
    });

    it('renders prompt textarea', () => {
        render(<TaskFormModal groups={defaultGroups} onClose={onClose} onCreated={onCreated} />);
        expect(screen.getByPlaceholderText('Enter the task prompt...')).toBeInTheDocument();
    });

    it('renders group selector with all groups', () => {
        render(<TaskFormModal groups={defaultGroups} onClose={onClose} onCreated={onCreated} />);
        expect(screen.getByText('Group One')).toBeInTheDocument();
        expect(screen.getByText('Group Two')).toBeInTheDocument();
    });

    it('shows context mode buttons in create mode', () => {
        render(<TaskFormModal groups={defaultGroups} onClose={onClose} onCreated={onCreated} />);
        expect(screen.getByRole('button', { name: 'isolated' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'group' })).toBeInTheDocument();
    });

    it('cancel button calls onClose', async () => {
        const user = userEvent.setup();
        render(<TaskFormModal groups={defaultGroups} onClose={onClose} onCreated={onCreated} />);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('close X button calls onClose', async () => {
        const user = userEvent.setup();
        render(<TaskFormModal groups={defaultGroups} onClose={onClose} onCreated={onCreated} />);
        // The X button is the first button in the header
        const buttons = screen.getAllByRole('button');
        // Click the close X (first button in header area)
        await user.click(buttons[0]);
        expect(onClose).toHaveBeenCalled();
    });

    it('successful submit calls onCreated and onClose', async () => {
        const user = userEvent.setup();
        render(<TaskFormModal groups={defaultGroups} onClose={onClose} onCreated={onCreated} />);
        await user.type(screen.getByPlaceholderText('Enter the task prompt...'), 'My task prompt');
        // Fill schedule value
        const inputs = screen.getAllByRole('textbox');
        const scheduleInput = inputs[inputs.length - 1];
        await user.type(scheduleInput, '0 9 * * *');
        await user.click(screen.getByRole('button', { name: 'Create Task' }));
        await waitFor(() => {
            expect(onCreated).toHaveBeenCalledTimes(1);
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    it('shows error message on API failure', async () => {
        vi.stubGlobal('fetch', mockFetchError(500, 'Server Error'));
        const user = userEvent.setup();
        render(<TaskFormModal groups={defaultGroups} onClose={onClose} onCreated={onCreated} />);
        await user.type(screen.getByPlaceholderText('Enter the task prompt...'), 'My task');
        const inputs = screen.getAllByRole('textbox');
        await user.type(inputs[inputs.length - 1], '*/5 * * * *');
        await user.click(screen.getByRole('button', { name: 'Create Task' }));
        await waitFor(() => {
            // apiFetch throws "API Error: <statusText>" on non-ok responses
            expect(screen.getByText(/API Error/i)).toBeInTheDocument();
        });
    });
});

describe('TaskFormModal — edit mode', () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetchSuccess({ updated: true }));
    });

    it('renders Edit Task heading', () => {
        render(
            <TaskFormModal
                groups={defaultGroups}
                editTask={editTask}
                onClose={onClose}
                onCreated={onCreated}
            />
        );
        expect(screen.getByRole('heading', { name: 'Edit Task' })).toBeInTheDocument();
    });

    it('populates prompt field with existing value', () => {
        render(
            <TaskFormModal
                groups={defaultGroups}
                editTask={editTask}
                onClose={onClose}
                onCreated={onCreated}
            />
        );
        expect(screen.getByDisplayValue('Existing prompt text')).toBeInTheDocument();
    });

    it('group selector is disabled in edit mode', () => {
        render(
            <TaskFormModal
                groups={defaultGroups}
                editTask={editTask}
                onClose={onClose}
                onCreated={onCreated}
            />
        );
        const select = screen.getByRole('combobox');
        expect(select).toBeDisabled();
    });

    it('does not show context mode buttons in edit mode', () => {
        render(
            <TaskFormModal
                groups={defaultGroups}
                editTask={editTask}
                onClose={onClose}
                onCreated={onCreated}
            />
        );
        expect(screen.queryByRole('button', { name: 'isolated' })).not.toBeInTheDocument();
    });

    it('shows Save Changes button', () => {
        render(
            <TaskFormModal
                groups={defaultGroups}
                editTask={editTask}
                onClose={onClose}
                onCreated={onCreated}
            />
        );
        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });
});
