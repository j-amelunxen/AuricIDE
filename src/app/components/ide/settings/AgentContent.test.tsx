import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentContent } from './AgentContent';
import { useStore } from '@/lib/store';
import { agentLogPurge } from '@/lib/tauri/agentLog';

vi.mock('@/lib/tauri/agentLog', () => ({
  agentLogPurge: vi.fn(async () => {}),
}));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(agentLogPurge).mockClear();
});

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

describe('AgentContent — CLI quota', () => {
  const originalRefresh = useStore.getState().refreshUsageLimits;

  afterEach(() => {
    useStore.setState({ refreshUsageLimits: originalRefresh });
  });

  it('offers a refresh button only after the chip is switched on', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn(async () => {});
    useStore.setState({ refreshUsageLimits: refresh });

    render(<AgentContent />);
    expect(screen.queryByTestId('cli-usage-limits-refresh')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('cli-usage-limits-toggle'));

    expect(screen.getByTestId('cli-usage-limits-refresh')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes Codex only when the button is pressed', async () => {
    const user = userEvent.setup();
    localStorage.setItem('auric.cli-usage-limits', 'true');
    const refresh = vi.fn(async () => {});
    useStore.setState({ refreshUsageLimits: refresh });

    render(<AgentContent />);
    await user.click(screen.getByTestId('cli-usage-limits-refresh'));

    expect(refresh).toHaveBeenCalledTimes(1);
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

describe('AgentContent — agent activity history', () => {
  const persistOn = () => localStorage.setItem('auric.agent-log.persist', 'true');

  it('keeps the history off until it is asked for', () => {
    render(<AgentContent />);

    expect(screen.getByTestId('agent-log-persist-toggle')).not.toBeChecked();
    expect(localStorage.getItem('auric.agent-log.persist')).toBeNull();
  });

  it('starts keeping history without asking anything', async () => {
    const user = userEvent.setup();
    render(<AgentContent />);

    await user.click(screen.getByTestId('agent-log-persist-toggle'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('agent-log-persist-toggle')).toBeChecked();
    expect(localStorage.getItem('auric.agent-log.persist')).toBe('true');
  });

  it('asks before switching the history off, and changes nothing until answered', async () => {
    const user = userEvent.setup();
    persistOn();
    render(<AgentContent />);

    await user.click(screen.getByTestId('agent-log-persist-toggle'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('agent-log-persist-toggle')).toBeChecked();
    expect(localStorage.getItem('auric.agent-log.persist')).toBe('true');
    expect(agentLogPurge).not.toHaveBeenCalled();
  });

  it('deletes the stored history once the user confirms', async () => {
    const user = userEvent.setup();
    persistOn();
    render(<AgentContent />);

    await user.click(screen.getByTestId('agent-log-persist-toggle'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete history' }));

    expect(screen.getByTestId('agent-log-persist-toggle')).not.toBeChecked();
    expect(localStorage.getItem('auric.agent-log.persist')).toBe('false');
    expect(agentLogPurge).toHaveBeenCalledTimes(1);
  });

  it('leaves the history alone when the user cancels', async () => {
    const user = userEvent.setup();
    persistOn();
    render(<AgentContent />);

    await user.click(screen.getByTestId('agent-log-persist-toggle'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('agent-log-persist-toggle')).toBeChecked();
    expect(localStorage.getItem('auric.agent-log.persist')).toBe('true');
    expect(agentLogPurge).not.toHaveBeenCalled();
  });

  it('says what switching it on records, credentials included', () => {
    // Someone reading this is deciding whether to write their agents' command
    // lines to disk. Describing only the off state leaves that unsaid.
    render(<AgentContent />);

    const description = screen.getByText(/commands your agents run/i);
    expect(description).toHaveTextContent(/api keys or passwords/i);
  });

  it('offers no retention span while nothing is being kept', () => {
    render(<AgentContent />);

    expect(screen.getByTestId('agent-log-retention')).toBeDisabled();
  });

  it('persists a chosen retention span once history is on', async () => {
    const user = userEvent.setup();
    persistOn();
    render(<AgentContent />);

    const retention = screen.getByTestId('agent-log-retention');
    expect(retention).toBeEnabled();
    expect(retention).toHaveValue('2');

    await user.selectOptions(retention, '30');

    expect(retention).toHaveValue('30');
    expect(localStorage.getItem('auric.agent-log.retention-days')).toBe('30');
  });
});
