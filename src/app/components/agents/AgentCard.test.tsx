import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { AgentCard } from './AgentCard';

// Mock useNow to return current time (avoids stale module-scope timestamps)
vi.mock('@/lib/hooks/useNow', () => ({
  useNow: () => Date.now(),
}));

const runningAgent: AgentInfo = {
  id: 'agent-1',
  name: 'Writer',
  model: 'claude-opus-4-6',
  provider: 'claude',
  status: 'running',
  currentTask: 'Writing documentation',
  startedAt: 1000,
};

const makeLiveAgent = (): AgentInfo => ({
  id: 'agent-live',
  name: 'Coder',
  model: 'claude-opus-4-6',
  provider: 'claude',
  status: 'running',
  currentTask: 'Implementing feature',
  startedAt: 1000,
  lastActivityAt: Date.now() - 100, // active within last 2 s
});

const idleAgent: AgentInfo = {
  id: 'agent-2',
  name: 'Reviewer',
  model: 'claude-sonnet-4-5-20250929',
  provider: 'claude',
  status: 'idle',
  startedAt: 2000,
};

describe('AgentCard', () => {
  it('renders agent name', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.getByText('Writer')).toBeInTheDocument();
  });

  it('renders abbreviated model name', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    // Model is displayed as first 2 segments: "claude opus"
    expect(screen.getByText('claude opus')).toBeInTheDocument();
  });

  it('shows current task text', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.getByText('Writing documentation')).toBeInTheDocument();
  });

  it('shows status text for running agent', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('shows status text for idle agent', () => {
    render(<AgentCard agent={idleAgent} onKill={vi.fn()} />);
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('terminate button calls onKill with agent id', async () => {
    const user = userEvent.setup();
    const onKill = vi.fn();
    render(<AgentCard agent={runningAgent} onKill={onKill} />);

    await user.click(screen.getByTitle('Terminate Agent'));
    expect(onKill).toHaveBeenCalledWith('agent-1');
  });

  it('renders with glass-card styling', () => {
    const { container } = render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(container.firstElementChild).toHaveClass('glass-card');
  });

  it('shows awaiting message when no task', () => {
    render(<AgentCard agent={idleAgent} onKill={vi.fn()} />);
    expect(screen.getByText('Awaiting instructions...')).toBeInTheDocument();
  });

  it('calls onSelect on card click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} onSelect={onSelect} />);
    // Click on the card's outer div (the first child)
    const card = screen.getByText('Writer').closest('.glass-card')!;
    await user.click(card);
    expect(onSelect).toHaveBeenCalledWith('agent-1');
  });

  it('displays agent id', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.getByText('agent-1')).toBeInTheDocument();
  });

  describe('live state', () => {
    it('shows Live badge when agent has recent activity', () => {
      render(<AgentCard agent={makeLiveAgent()} onKill={vi.fn()} />);
      expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('applies glow class to card when agent is live', () => {
      const { container } = render(<AgentCard agent={makeLiveAgent()} onKill={vi.fn()} />);
      expect(container.firstElementChild?.className).toContain('shadow-');
    });

    it('does not show Idle badge when agent is live', () => {
      render(<AgentCard agent={makeLiveAgent()} onKill={vi.fn()} />);
      expect(screen.queryByText('Idle')).not.toBeInTheDocument();
    });
  });

  describe('idle state', () => {
    it('shows Idle badge when running agent has no recent activity', () => {
      render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
      expect(screen.getByText('Idle')).toBeInTheDocument();
    });

    it('does not show Live badge when agent has no recent activity', () => {
      render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
      expect(screen.queryByText('Live')).not.toBeInTheDocument();
    });

    it('does not show Idle badge for non-running agents', () => {
      render(<AgentCard agent={idleAgent} onKill={vi.fn()} />);
      expect(screen.queryByText('Idle')).not.toBeInTheDocument();
    });
  });
});
