import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetchSuccess } from '../../__tests__/helpers/mock-fetch';
import { createMockSocket } from '../../__tests__/helpers/mock-socket';

const mockSocket = createMockSocket();

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => mockSocket),
}));

vi.mock('dompurify', () => ({
    default: { sanitize: (s: string) => s },
}));

// Import component once (module-level) to avoid stale module cache issues
import { SearchOverlay } from '../SearchOverlay';

describe('SearchOverlay', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', mockFetchSuccess({ results: [], total: 0 }));
    });

    function renderOverlay(isOpen = true) {
        const onClose = vi.fn();
        const utils = render(<SearchOverlay isOpen={isOpen} onClose={onClose} />);
        return { ...utils, onClose };
    }

    it('renders nothing when isOpen is false', () => {
        const { container } = renderOverlay(false);
        expect(container.firstChild).toBeNull();
    });

    it('renders search input when open', () => {
        renderOverlay();
        expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    });

    it('shows minimum characters prompt initially', () => {
        renderOverlay();
        expect(screen.getByText('Type at least 2 characters to search')).toBeInTheDocument();
    });

    it('closes when backdrop is clicked', async () => {
        const user = userEvent.setup();
        const { onClose } = renderOverlay();
        const backdrop = document.querySelector('.absolute.inset-0');
        expect(backdrop).not.toBeNull();
        await user.click(backdrop as HTMLElement);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape key via keydown on the search panel', async () => {
        const user = userEvent.setup();
        const { onClose } = renderOverlay();
        // Focus the input first so keyboard events are dispatched to the panel
        const input = screen.getByPlaceholderText('Search messages...');
        await user.click(input);
        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows no results message for query with no results', async () => {
        const user = userEvent.setup();
        renderOverlay();
        const input = screen.getByPlaceholderText('Search messages...');
        await user.type(input, 'xyz');
        await waitFor(() => {
            expect(screen.getByText(/No results found/)).toBeInTheDocument();
        }, { timeout: 1000 });
    });

    it('clear button appears when query is non-empty', async () => {
        const user = userEvent.setup();
        renderOverlay();
        await user.type(screen.getByPlaceholderText('Search messages...'), 'he');
        // The clear X button should now be visible
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
    });

    it('renders search results when API returns data', async () => {
        const results = [
            { id: 1, chatJid: 'group@g.us', sender: 'Alice', content: 'Hello world', timestamp: '2024-01-01T10:00:00Z', isFromMe: false, snippet: 'Hello world', rank: 1 },
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: { results, total: 1 } }),
        }));
        const user = userEvent.setup();
        renderOverlay();
        await user.type(screen.getByPlaceholderText('Search messages...'), 'world');
        await waitFor(() => {
            expect(screen.getByText('Alice')).toBeInTheDocument();
        }, { timeout: 2000 });
    });
});
