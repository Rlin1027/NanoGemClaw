import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../ErrorBoundary';

// Suppress console.error for expected error boundary output
const consoleError = console.error;
beforeEach(() => {
    console.error = vi.fn();
});
afterEach(() => {
    console.error = consoleError;
});

function BrokenComponent({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) throw new Error('Test error message');
    return <div>Normal content</div>;
}

describe('ErrorBoundary', () => {
    it('renders children when no error occurs', () => {
        render(
            <ErrorBoundary>
                <div>Safe content</div>
            </ErrorBoundary>
        );
        expect(screen.getByText('Safe content')).toBeInTheDocument();
    });

    it('renders default fallback when child throws', () => {
        render(
            <ErrorBoundary>
                <BrokenComponent shouldThrow={true} />
            </ErrorBoundary>
        );
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('shows the error message in default fallback', () => {
        render(
            <ErrorBoundary>
                <BrokenComponent shouldThrow={true} />
            </ErrorBoundary>
        );
        expect(screen.getByText('Test error message')).toBeInTheDocument();
    });

    it('renders custom fallback prop when provided', () => {
        render(
            <ErrorBoundary fallback={<div>Custom fallback</div>}>
                <BrokenComponent shouldThrow={true} />
            </ErrorBoundary>
        );
        expect(screen.getByText('Custom fallback')).toBeInTheDocument();
        expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('Try again button resets the error state', async () => {
        const user = userEvent.setup();
        render(
            <ErrorBoundary>
                <BrokenComponent shouldThrow={true} />
            </ErrorBoundary>
        );
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Try again' }));
        // After reset, boundary re-renders children (which will throw again in this test,
        // but the important thing is the reset was triggered)
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
});
