import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentContent } from './AgentContent';

beforeEach(() => localStorage.clear());

describe('AgentContent — agent providers', () => {
  it('lists the configured providers and offers an import button', () => {
    render(<AgentContent />);
    // The store seeds a Crush fallback provider in browser/test mode.
    const list = screen.getByTestId('provider-list');
    expect(list).toHaveTextContent(/Crush/i);
    expect(screen.getByTestId('import-provider-button')).toBeInTheDocument();
  });

  it('asks before skipping permission prompts and changes the setting only after confirmation', async () => {
    const user = userEvent.setup();
    render(<AgentContent />);

    const toggle = screen.getByRole('checkbox', { name: /skip permission prompts/i });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/skip permission prompts\?/i);
    expect(toggle).not.toBeChecked();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Skip prompts' })
    );
    expect(toggle).toBeChecked();
  });

  it('persists the agent terminal font size', async () => {
    const user = userEvent.setup();
    render(<AgentContent />);

    const size = screen.getByTestId('agent-terminal-font-size');
    expect(size).toHaveValue('14');

    await user.selectOptions(size, '18');

    expect(localStorage.getItem('auric.agent-terminal-font-size')).toBe('18');
  });

  it('displays every valid persisted terminal font size', () => {
    localStorage.setItem('auric.agent-terminal-font-size', '17');

    render(<AgentContent />);

    expect(screen.getByTestId('agent-terminal-font-size')).toHaveValue('17');
  });

  it('gives the terminal font-size select a visible keyboard focus indicator', () => {
    render(<AgentContent />);

    expect(screen.getByTestId('agent-terminal-font-size').className).toContain(
      'focus-visible:ring-2'
    );
  });
});

describe('AgentContent — Agent Console auto-open', () => {
  it('defaults to off and persists a change', async () => {
    const user = userEvent.setup();
    render(<AgentContent />);

    const toggle = screen.getByTestId('agent-console-auto-open-toggle');
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(localStorage.getItem('auric.agent-console-auto-open')).toBe('true');
  });

  it('reads a previously persisted value on mount', () => {
    localStorage.setItem('auric.agent-console-auto-open', 'true');

    render(<AgentContent />);

    expect(screen.getByTestId('agent-console-auto-open-toggle')).toBeChecked();
  });
});
