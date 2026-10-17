import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SupervisorProviderModal } from './SupervisorProviderModal';

describe('SupervisorProviderModal', () => {
  it('renders nothing when choice is null', () => {
    const { container } = render(<SupervisorProviderModal choice={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders provider candidate buttons and details', () => {
    const choice = {
      candidates: [
        { id: 'claude', name: 'Claude Code' },
        { id: 'codex', name: 'Codex' },
      ],
      resolve: vi.fn(),
    };

    render(<SupervisorProviderModal choice={choice} onClose={() => {}} />);

    expect(screen.getByRole('dialog', { name: /start supervisor/i })).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('claude')).toBeInTheDocument();
    expect(screen.getByText('codex')).toBeInTheDocument();
  });

  it('resolves with selected provider id and calls onClose on candidate click', async () => {
    const resolve = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const choice = {
      candidates: [
        { id: 'claude', name: 'Claude Code' },
        { id: 'codex', name: 'Codex' },
      ],
      resolve,
    };

    render(<SupervisorProviderModal choice={choice} onClose={onClose} />);

    await user.click(screen.getByTestId('supervisor-start-provider-codex'));

    expect(resolve).toHaveBeenCalledWith('codex');
    expect(onClose).toHaveBeenCalled();
  });

  it('resolves with null and calls onClose when cancel button is clicked', async () => {
    const resolve = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const choice = {
      candidates: [
        { id: 'claude', name: 'Claude Code' },
        { id: 'codex', name: 'Codex' },
      ],
      resolve,
    };

    render(<SupervisorProviderModal choice={choice} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(resolve).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });
});
