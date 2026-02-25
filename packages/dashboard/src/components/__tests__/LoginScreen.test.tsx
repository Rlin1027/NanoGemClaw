import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginScreen } from '../LoginScreen';
import { mockFetchSuccess, mockFetchError, mockFetchNetworkError } from '../../__tests__/helpers/mock-fetch';

describe('LoginScreen', () => {
    const onSuccess = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();
    });

    it('renders the login form with password input', () => {
        render(<LoginScreen onSuccess={onSuccess} />);
        expect(screen.getByPlaceholderText('Enter Access Code')).toBeInTheDocument();
    });

    it('renders the NanoGemClaw heading', () => {
        render(<LoginScreen onSuccess={onSuccess} />);
        expect(screen.getByText('NanoGemClaw')).toBeInTheDocument();
    });

    it('renders the Access Dashboard button', () => {
        render(<LoginScreen onSuccess={onSuccess} />);
        expect(screen.getByText('Access Dashboard')).toBeInTheDocument();
    });

    it('submit button is disabled when input is empty', () => {
        render(<LoginScreen onSuccess={onSuccess} />);
        const button = screen.getByRole('button');
        expect(button).toBeDisabled();
    });

    it('submit button is enabled when input has a value', async () => {
        const user = userEvent.setup();
        render(<LoginScreen onSuccess={onSuccess} />);
        await user.type(screen.getByPlaceholderText('Enter Access Code'), 'mycode');
        const button = screen.getByRole('button');
        expect(button).not.toBeDisabled();
    });

    it('on successful auth: stores code in localStorage and calls onSuccess', async () => {
        vi.stubGlobal('fetch', mockFetchSuccess({}));
        const user = userEvent.setup();
        render(<LoginScreen onSuccess={onSuccess} />);
        await user.type(screen.getByPlaceholderText('Enter Access Code'), 'valid-code');
        await user.click(screen.getByRole('button'));
        await waitFor(() => {
            expect(localStorage.setItem).toHaveBeenCalledWith('nanogemclaw_access_code', 'valid-code');
            expect(onSuccess).toHaveBeenCalledTimes(1);
        });
    });

    it('on failed auth: shows Invalid access code error', async () => {
        vi.stubGlobal('fetch', mockFetchError(401, 'Unauthorized'));
        const user = userEvent.setup();
        render(<LoginScreen onSuccess={onSuccess} />);
        await user.type(screen.getByPlaceholderText('Enter Access Code'), 'wrong-code');
        await user.click(screen.getByRole('button'));
        await waitFor(() => {
            expect(screen.getByText('Invalid access code')).toBeInTheDocument();
        });
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('on network error: shows Connection failed error', async () => {
        vi.stubGlobal('fetch', mockFetchNetworkError());
        const user = userEvent.setup();
        render(<LoginScreen onSuccess={onSuccess} />);
        await user.type(screen.getByPlaceholderText('Enter Access Code'), 'any-code');
        await user.click(screen.getByRole('button'));
        await waitFor(() => {
            expect(screen.getByText('Connection failed')).toBeInTheDocument();
        });
    });

    it('does not store access code on failed auth', async () => {
        vi.stubGlobal('fetch', mockFetchError(401, 'Unauthorized'));
        const user = userEvent.setup();
        render(<LoginScreen onSuccess={onSuccess} />);
        await user.type(screen.getByPlaceholderText('Enter Access Code'), 'wrong-code');
        await user.click(screen.getByRole('button'));
        await waitFor(() => {
            expect(screen.getByText('Invalid access code')).toBeInTheDocument();
        });
        expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('clears error on new submission attempt', async () => {
        vi.stubGlobal('fetch', mockFetchError(401, 'Unauthorized'));
        const user = userEvent.setup();
        render(<LoginScreen onSuccess={onSuccess} />);
        await user.type(screen.getByPlaceholderText('Enter Access Code'), 'bad');
        await user.click(screen.getByRole('button'));
        await waitFor(() => expect(screen.getByText('Invalid access code')).toBeInTheDocument());

        vi.stubGlobal('fetch', mockFetchSuccess({}));
        await user.click(screen.getByRole('button'));
        await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    });
});
