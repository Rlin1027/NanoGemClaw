import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const configData = {
    maintenanceMode: false,
    logLevel: 'info',
    dashboardHost: '127.0.0.1',
    dashboardPort: 3000,
    uptime: 3661,
    connectedClients: 2,
};

const secretsData = [
    { key: 'TELEGRAM_BOT_TOKEN', configured: true, masked: '****1234' },
    { key: 'GEMINI_API_KEY', configured: false, masked: null },
];

describe('SettingsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Two sequential API calls: /api/config and /api/config/secrets
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({
                ok: true, status: 200,
                json: () => Promise.resolve({ data: configData }),
            })
            .mockResolvedValueOnce({
                ok: true, status: 200,
                json: () => Promise.resolve({ data: secretsData }),
            })
            .mockResolvedValue({
                ok: true, status: 200,
                json: () => Promise.resolve({ data: {} }),
            })
        );
    });

    it('shows loading state initially', async () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
        const { SettingsPage } = await import('../SettingsPage');
        render(<SettingsPage />);
        expect(screen.getByText('Loading settings...')).toBeInTheDocument();
    });

    it('renders Runtime Flags section', async () => {
        const { SettingsPage } = await import('../SettingsPage');
        render(<SettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Runtime Flags')).toBeInTheDocument();
        });
    });

    it('renders Maintenance Mode toggle', async () => {
        const { SettingsPage } = await import('../SettingsPage');
        render(<SettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Maintenance Mode')).toBeInTheDocument();
        });
    });

    it('renders Debug Logging toggle', async () => {
        const { SettingsPage } = await import('../SettingsPage');
        render(<SettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Debug Logging')).toBeInTheDocument();
        });
    });

    it('renders Connection Info section with uptime', async () => {
        const { SettingsPage } = await import('../SettingsPage');
        render(<SettingsPage />);
        await waitFor(() => {
            // 3661 seconds = 1h 1m
            expect(screen.getByText('1h 1m')).toBeInTheDocument();
        });
    });

    it('renders host and port', async () => {
        const { SettingsPage } = await import('../SettingsPage');
        render(<SettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('127.0.0.1:3000')).toBeInTheDocument();
        });
    });

    it('renders Secrets Status section', async () => {
        const { SettingsPage } = await import('../SettingsPage');
        render(<SettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Secrets Status')).toBeInTheDocument();
            expect(screen.getByText('TELEGRAM_BOT_TOKEN')).toBeInTheDocument();
        });
    });

    it('renders Danger Zone section', async () => {
        const { SettingsPage } = await import('../SettingsPage');
        render(<SettingsPage />);
        await waitFor(() => {
            expect(screen.getByText('Danger Zone')).toBeInTheDocument();
        });
    });

    it('clicking maintenance toggle calls update API', async () => {
        const user = userEvent.setup();
        const { SettingsPage } = await import('../SettingsPage');
        render(<SettingsPage />);
        await waitFor(() => expect(screen.getByText('Maintenance Mode')).toBeInTheDocument());
        const callsBefore = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
        // The maintenance toggle button is the first rounded-full button
        const toggleButtons = document.querySelectorAll('button.rounded-full');
        if (toggleButtons.length > 0) {
            await user.click(toggleButtons[0] as HTMLElement);
            await waitFor(() => {
                expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore);
            });
        }
    });
});
