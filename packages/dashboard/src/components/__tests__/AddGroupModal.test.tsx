import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddGroupModal } from '../AddGroupModal';
import { mockFetchSuccess } from '../../__tests__/helpers/mock-fetch';

const discoveredChats = [
    { jid: 'chat1@g.us', name: 'Dev Team', last_message_time: '2024-01-15T10:00:00Z' },
    { jid: 'chat2@g.us', name: 'Marketing', last_message_time: '2024-01-14T09:00:00Z' },
];

describe('AddGroupModal', () => {
    const onClose = vi.fn();
    const onAdded = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the Add Group heading', async () => {
        vi.stubGlobal('fetch', mockFetchSuccess(discoveredChats));
        render(<AddGroupModal onClose={onClose} onAdded={onAdded} registeredIds={new Set()} />);
        expect(screen.getByText('Add Group')).toBeInTheDocument();
    });

    it('shows loading state initially', () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never resolves
        render(<AddGroupModal onClose={onClose} onAdded={onAdded} registeredIds={new Set()} />);
        expect(screen.getByText('Discovering chats...')).toBeInTheDocument();
    });

    it('renders discovered chats after load', async () => {
        vi.stubGlobal('fetch', mockFetchSuccess(discoveredChats));
        render(<AddGroupModal onClose={onClose} onAdded={onAdded} registeredIds={new Set()} />);
        await waitFor(() => {
            expect(screen.getByText('Dev Team')).toBeInTheDocument();
            expect(screen.getByText('Marketing')).toBeInTheDocument();
        });
    });

    it('filters out already-registered groups', async () => {
        vi.stubGlobal('fetch', mockFetchSuccess(discoveredChats));
        render(
            <AddGroupModal
                onClose={onClose}
                onAdded={onAdded}
                registeredIds={new Set(['chat1@g.us'])}
            />
        );
        await waitFor(() => {
            expect(screen.queryByText('Dev Team')).not.toBeInTheDocument();
            expect(screen.getByText('Marketing')).toBeInTheDocument();
        });
    });

    it('shows empty state when all chats are registered', async () => {
        vi.stubGlobal('fetch', mockFetchSuccess(discoveredChats));
        render(
            <AddGroupModal
                onClose={onClose}
                onAdded={onAdded}
                registeredIds={new Set(['chat1@g.us', 'chat2@g.us'])}
            />
        );
        await waitFor(() => {
            expect(screen.getByText('No new groups found.')).toBeInTheDocument();
        });
    });

    it('register button calls API and onAdded on success', async () => {
        vi.stubGlobal('fetch', mockFetchSuccess(discoveredChats)
            .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: discoveredChats }) })
            .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) })
        );
        const user = userEvent.setup();
        render(<AddGroupModal onClose={onClose} onAdded={onAdded} registeredIds={new Set()} />);
        await waitFor(() => expect(screen.getByText('Dev Team')).toBeInTheDocument());
        const registerButtons = screen.getAllByRole('button', { name: /register/i });
        await user.click(registerButtons[0]);
        await waitFor(() => {
            expect(onAdded).toHaveBeenCalledTimes(1);
        });
    });

    it('Close button calls onClose', async () => {
        vi.stubGlobal('fetch', mockFetchSuccess(discoveredChats));
        const user = userEvent.setup();
        render(<AddGroupModal onClose={onClose} onAdded={onAdded} registeredIds={new Set()} />);
        await waitFor(() => expect(screen.getByText('Dev Team')).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
