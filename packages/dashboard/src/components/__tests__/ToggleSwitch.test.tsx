import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToggleSwitch } from '../ToggleSwitch';

describe('ToggleSwitch', () => {
    it('renders the label', () => {
        render(<ToggleSwitch enabled={false} onChange={vi.fn()} label="Enable Feature" />);
        expect(screen.getByText('Enable Feature')).toBeInTheDocument();
    });

    it('renders the description when provided', () => {
        render(
            <ToggleSwitch
                enabled={false}
                onChange={vi.fn()}
                label="Feature"
                description="This enables the feature"
            />
        );
        expect(screen.getByText('This enables the feature')).toBeInTheDocument();
    });

    it('does not render description element when not provided', () => {
        render(<ToggleSwitch enabled={false} onChange={vi.fn()} label="Feature" />);
        expect(screen.queryByText('This enables the feature')).not.toBeInTheDocument();
    });

    it('calls onChange with true when toggled from off', async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(<ToggleSwitch enabled={false} onChange={onChange} label="Feature" />);
        await user.click(screen.getByRole('button'));
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('calls onChange with false when toggled from on', async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(<ToggleSwitch enabled={true} onChange={onChange} label="Feature" />);
        await user.click(screen.getByRole('button'));
        expect(onChange).toHaveBeenCalledWith(false);
    });

    it('does not call onChange when disabled', async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(<ToggleSwitch enabled={false} onChange={onChange} label="Feature" disabled={true} />);
        await user.click(screen.getByRole('button'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('button is disabled when disabled prop is true', () => {
        render(<ToggleSwitch enabled={false} onChange={vi.fn()} label="Feature" disabled={true} />);
        expect(screen.getByRole('button')).toBeDisabled();
    });
});
