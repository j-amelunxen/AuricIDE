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

    await user.click(screen.getByRole('button', { name: 'Terminate Agent' }));
    expect(onKill).toHaveBeenCalledWith('agent-1');
  });

  it('exposes icon-only controls by accessible labels', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Terminate Agent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Terminal' })).toBeInTheDocument();
  });

  it('hides icon glyphs from assistive technology', () => {
    const { container } = render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    const icons = container.querySelectorAll('.material-symbols-outlined');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
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

    it('stays live while its timestamp is merely one bump interval stale', () => {
      // The store refreshes lastActivityAt at most every 2s, so a busy agent's
      // timestamp is routinely that old. Reading that as "gone idle" made the
      // badge and the pulsing dot flicker several times a minute.
      const streaming = { ...makeLiveAgent(), lastActivityAt: Date.now() - 2_500 };
      render(<AgentCard agent={streaming} onKill={vi.fn()} />);
      expect(screen.getByText('Live')).toBeInTheDocument();
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

describe('AgentCard – naming', () => {
  it('has no rename affordance when renaming is not offered', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /rename/i })).not.toBeInTheDocument();
  });

  it('opens an editor seeded with the current name', async () => {
    const user = userEvent.setup();
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} onRename={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Rename agent' }));
    expect(screen.getByRole('textbox', { name: 'Agent name' })).toHaveValue('Writer');
  });

  it('commits the new name on Enter', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: 'Rename agent' }));
    await user.clear(screen.getByRole('textbox', { name: 'Agent name' }));
    await user.type(screen.getByRole('textbox', { name: 'Agent name' }), 'Docs sweep{Enter}');

    expect(onRename).toHaveBeenCalledWith('agent-1', 'Docs sweep');
    expect(screen.queryByRole('textbox', { name: 'Agent name' })).not.toBeInTheDocument();
  });

  it('commits on blur, so clicking away does not silently discard the name', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: 'Rename agent' }));
    await user.clear(screen.getByRole('textbox', { name: 'Agent name' }));
    await user.type(screen.getByRole('textbox', { name: 'Agent name' }), 'Docs sweep');
    await user.tab();

    expect(onRename).toHaveBeenCalledWith('agent-1', 'Docs sweep');
  });

  it('abandons the edit on Escape', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: 'Rename agent' }));
    await user.type(screen.getByRole('textbox', { name: 'Agent name' }), 'nonsense{Escape}');

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Writer')).toBeInTheDocument();
  });

  it('does not accept an empty name', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: 'Rename agent' }));
    await user.clear(screen.getByRole('textbox', { name: 'Agent name' }));
    await user.keyboard('{Enter}');

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Writer')).toBeInTheDocument();
  });

  it('does not select the agent while its name is being edited', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <AgentCard agent={runningAgent} onKill={vi.fn()} onRename={vi.fn()} onSelect={onSelect} />
    );

    await user.click(screen.getByRole('button', { name: 'Rename agent' }));
    onSelect.mockClear();
    await user.click(screen.getByRole('textbox', { name: 'Agent name' }));

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('AgentCard – elapsed time', () => {
  it('says how long a running agent has been working', () => {
    render(
      <AgentCard agent={{ ...runningAgent, startedAt: Date.now() - 5 * 60_000 }} onKill={vi.fn()} />
    );
    expect(screen.getByTestId('agent-runtime')).toHaveTextContent('5m');
  });

  it('says how long a quiet agent has been quiet', () => {
    // "Idle" alone can mean five seconds of thinking or twenty minutes of
    // waiting on a question nobody answered.
    render(
      <AgentCard
        agent={{
          ...runningAgent,
          startedAt: Date.now() - 20 * 60_000,
          lastActivityAt: Date.now() - 7 * 60_000,
        }}
        onKill={vi.fn()}
      />
    );
    expect(screen.getByText('Idle 7m')).toBeInTheDocument();
  });

  it('says only Idle before the agent has produced anything', () => {
    // With no activity yet there is no silence to measure — claiming one
    // would be inventing a number.
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  it('does not run a clock on an agent that has stopped', () => {
    render(<AgentCard agent={{ ...idleAgent, startedAt: Date.now() - 60_000 }} onKill={vi.fn()} />);
    expect(screen.queryByTestId('agent-runtime')).not.toBeInTheDocument();
  });
});

describe('AgentCard – current activity', () => {
  it('shows what the agent is doing right now', () => {
    render(
      <AgentCard
        agent={{ ...runningAgent, currentActivity: 'Editing setup.ts' }}
        onKill={vi.fn()}
      />
    );
    expect(screen.getByTestId('agent-activity')).toHaveTextContent('Editing setup.ts');
  });

  it('shows it alongside the instruction, not instead of it', () => {
    render(
      <AgentCard
        agent={{ ...runningAgent, currentActivity: 'Editing setup.ts' }}
        onKill={vi.fn()}
      />
    );
    expect(screen.getByText('Writing documentation')).toBeInTheDocument();
    expect(screen.getByTestId('agent-activity')).toBeInTheDocument();
  });

  it('spends no space on the line before there is any output', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.queryByTestId('agent-activity')).not.toBeInTheDocument();
  });

  it('drops the line once the agent has finished', () => {
    // A last log line frozen in place would read as ongoing work.
    render(
      <AgentCard agent={{ ...idleAgent, currentActivity: 'Editing setup.ts' }} onKill={vi.fn()} />
    );
    expect(screen.queryByTestId('agent-activity')).not.toBeInTheDocument();
  });
});
