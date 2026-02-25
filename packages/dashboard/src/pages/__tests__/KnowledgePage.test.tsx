import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockSocket } from '../../__tests__/helpers/mock-socket';

const mockSocket = createMockSocket();

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => mockSocket),
}));

// Mock Monaco editor (heavy dependency not needed for tests)
vi.mock('@monaco-editor/react', () => ({
    default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <textarea data-testid="monaco-editor" value={value} onChange={e => onChange(e.target.value)} />
    ),
}));

const sampleDocs = [
    { id: 1, title: 'Getting Started', filename: 'getting-started.md', content: '# Getting Started\nHello', size_chars: 250 },
    { id: 2, title: 'API Reference', filename: 'api-reference.md', content: '# API\nDocs', size_chars: 500 },
];

describe('KnowledgePage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: sampleDocs }),
        }));
    });

    it('renders Knowledge Base heading', async () => {
        const { KnowledgePage } = await import('../KnowledgePage');
        render(<KnowledgePage />);
        expect(screen.getByText('Knowledge Base')).toBeInTheDocument();
    });

    it('renders New Document button', async () => {
        const { KnowledgePage } = await import('../KnowledgePage');
        render(<KnowledgePage />);
        expect(screen.getByRole('button', { name: /New Document/i })).toBeInTheDocument();
    });

    it('renders group selector', async () => {
        const { KnowledgePage } = await import('../KnowledgePage');
        render(<KnowledgePage />);
        expect(screen.getByRole('option', { name: 'Select a group' })).toBeInTheDocument();
    });

    it('renders search input', async () => {
        const { KnowledgePage } = await import('../KnowledgePage');
        render(<KnowledgePage />);
        expect(screen.getByPlaceholderText(/Search documents/i)).toBeInTheDocument();
    });

    it('shows select a group prompt when no group selected', async () => {
        const { KnowledgePage } = await import('../KnowledgePage');
        render(<KnowledgePage />);
        expect(screen.getByText('Select a group to view knowledge base')).toBeInTheDocument();
    });

    it('shows document list after selecting a group', async () => {
        const user = userEvent.setup();
        const { KnowledgePage } = await import('../KnowledgePage');
        render(<KnowledgePage />);
        // Fire the socket event after render so the registered listener picks it up
        act(() => {
            mockSocket.__simulateEvent('groups:update', [
                { id: 'group-1', name: 'Dev Team', status: 'active', messageCount: 10, activeTasks: 0 },
            ]);
        });
        await waitFor(() => {
            expect(screen.getByRole('option', { name: 'Dev Team' })).toBeInTheDocument();
        });
        const select = screen.getByRole('combobox');
        await user.selectOptions(select, 'group-1');
        await waitFor(() => {
            expect(screen.getByText('Documents')).toBeInTheDocument();
        });
    });
});
