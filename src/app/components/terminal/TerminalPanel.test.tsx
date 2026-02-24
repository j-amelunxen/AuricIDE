import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { TerminalPanel } from './TerminalPanel';

// Mock XtermTerminal since it requires real DOM APIs (canvas, matchMedia, etc.)
vi.mock('./XtermTerminal', () => ({
  XtermTerminal: ({ id, cwd }: { id: string; cwd?: string }) => (
    <div data-testid={`xterm-${id}`} data-cwd={cwd ?? ''}>
      Terminal: {id}
    </div>
  ),
}));

const testAgents: AgentInfo[] = [
  {
    id: 'agent-1',
    name: 'Writer',
    model: 'm',
    provider: 'claude',
    status: 'running',
    startedAt: 0,
  },
  { id: 'agent-2', name: 'Reviewer', model: 'm', provider: 'claude', status: 'idle', startedAt: 0 },
];

describe('TerminalPanel', () => {
  it('renders the panel container', () => {
    render(<TerminalPanel />);
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
  });

  it('renders the main terminal tab', () => {
    render(<TerminalPanel />);
    expect(screen.getByText('Main Terminal')).toBeInTheDocument();
  });

  it('renders agent tabs when agents are provided', () => {
    render(<TerminalPanel agents={testAgents} />);
    expect(screen.getByText('Writer')).toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
  });

  it('renders xterm terminal for main terminal', () => {
    render(<TerminalPanel />);
    expect(screen.getByTestId('xterm-main-terminal')).toBeInTheDocument();
  });

  it('only mounts the active agent terminal (lazy mount)', () => {
    render(<TerminalPanel agents={testAgents} />);
    // Default active tab is 'terminal', so no agent terminals should be mounted
    expect(screen.queryByTestId('xterm-agent-agent-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('xterm-agent-agent-2')).not.toBeInTheDocument();
  });

  it('switches active tab when agent tab is clicked', async () => {
    const user = userEvent.setup();
    const onSelectAgent = vi.fn();
    render(<TerminalPanel agents={testAgents} onSelectAgent={onSelectAgent} />);

    await user.click(screen.getByText('Writer'));
    expect(onSelectAgent).toHaveBeenCalledWith('agent-1');
  });

  it('calls onSelectAgent with null when main terminal tab is clicked', async () => {
    const user = userEvent.setup();
    const onSelectAgent = vi.fn();
    render(
      <TerminalPanel agents={testAgents} selectedAgentId="agent-1" onSelectAgent={onSelectAgent} />
    );

    await user.click(screen.getByText('Main Terminal'));
    expect(onSelectAgent).toHaveBeenCalledWith(null);
  });

  it('shows no agent tabs when agents list is empty', () => {
    render(<TerminalPanel agents={[]} />);
    const buttons = screen.getAllByRole('button');
    // Only the main terminal tab
    expect(buttons).toHaveLength(1);
  });

  describe('extra terminals', () => {
    const extraTerminals = [
      { id: 'extra-1', label: '/src/components', cwd: '/project/src/components' },
      { id: 'extra-2', label: '/src/utils', cwd: '/project/src/utils' },
    ];

    it('renders extra terminal tabs', () => {
      render(<TerminalPanel extraTerminals={extraTerminals} />);
      expect(screen.getByText('/src/components')).toBeInTheDocument();
      expect(screen.getByText('/src/utils')).toBeInTheDocument();
    });

    it('renders close button on extra terminal tabs', () => {
      render(<TerminalPanel extraTerminals={extraTerminals} />);
      const closeButtons = screen.getAllByLabelText('Close terminal');
      expect(closeButtons).toHaveLength(2);
    });

    it('calls onCloseTerminal when close button is clicked', async () => {
      const user = userEvent.setup();
      const onCloseTerminal = vi.fn();
      render(<TerminalPanel extraTerminals={extraTerminals} onCloseTerminal={onCloseTerminal} />);

      const closeButtons = screen.getAllByLabelText('Close terminal');
      await user.click(closeButtons[0]);
      expect(onCloseTerminal).toHaveBeenCalledWith('extra-1');
    });

    it('mounts XtermTerminal with correct cwd for extra terminals', () => {
      render(<TerminalPanel extraTerminals={extraTerminals} />);
      const term1 = screen.getByTestId('xterm-extra-extra-1');
      const term2 = screen.getByTestId('xterm-extra-extra-2');
      expect(term1).toHaveAttribute('data-cwd', '/project/src/components');
      expect(term2).toHaveAttribute('data-cwd', '/project/src/utils');
    });
  });
});
