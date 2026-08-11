import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { AgentCard } from './AgentCard';

// Mock useNow to return current time (avoids stale module-scope timestamps)
vi.mock('@/lib/hooks/useNow', () => ({
  useNow: () => Date.now(),
}));

vi.mock('@/lib/tauri/terminal', () => ({
  writeToShell: vi.fn(async () => undefined),
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

  it('names the state in words a person uses', () => {
    // The raw status field calls a finished agent "idle" and a quiet running
    // one "running" — neither is what the reader needs to know.
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.getByTestId('agent-state')).toHaveTextContent('Waiting');
  });

  it('tells a finished agent apart from a quiet one', () => {
    render(<AgentCard agent={idleAgent} onKill={vi.fn()} />);
    expect(screen.getByTestId('agent-state')).toHaveTextContent('Done');
  });

  it('says when the agent is blocked on the user, even while it looks live', () => {
    // A redrawing permission menu keeps lastActivityAt fresh — without this
    // state the card would claim "Working" while the agent waits for a human.
    render(<AgentCard agent={{ ...makeLiveAgent(), awaitingInput: true }} onKill={vi.fn()} />);
    expect(screen.getByTestId('agent-state')).toHaveTextContent('Needs input');
  });

  it('says exactly once what the state is', () => {
    render(<AgentCard agent={makeLiveAgent()} onKill={vi.fn()} />);
    expect(screen.getAllByTestId('agent-state')).toHaveLength(1);
    expect(screen.getByTestId('agent-state')).toHaveTextContent('Working');
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
    const icons = container.querySelectorAll('[data-icon]');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  });

  it('renders with glass-card styling', () => {
    const { container } = render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(container.firstElementChild).toHaveClass('glass-card');
  });

  it('shows awaiting message when no task', () => {
    render(<AgentCard agent={idleAgent} onKill={vi.fn()} />);
    expect(screen.getByText('Awaiting instructions…')).toBeInTheDocument();
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

  it('keeps the agent id reachable without spending space on it', () => {
    // The id is for debugging, not for reading — the name identifies the agent.
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.queryByText('agent-1')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Writer' })).toHaveAttribute(
      'title',
      expect.stringContaining('agent-1')
    );
  });

  describe('live state', () => {
    it('reads as working when the agent has recent activity', () => {
      render(<AgentCard agent={makeLiveAgent()} onKill={vi.fn()} />);
      expect(screen.getByTestId('agent-state')).toHaveTextContent('Working');
    });

    it('applies glow class to card when agent is live', () => {
      const { container } = render(<AgentCard agent={makeLiveAgent()} onKill={vi.fn()} />);
      expect(container.firstElementChild?.className).toContain('shadow-');
    });

    it('does not also claim to be waiting', () => {
      render(<AgentCard agent={makeLiveAgent()} onKill={vi.fn()} />);
      expect(screen.getByTestId('agent-state')).not.toHaveTextContent('Waiting');
    });

    it('stays live while its timestamp is merely one bump interval stale', () => {
      // The store refreshes lastActivityAt at most every 2s, so a busy agent's
      // timestamp is routinely that old. Reading that as "gone idle" made the
      // badge and the pulsing dot flicker several times a minute.
      const streaming = { ...makeLiveAgent(), lastActivityAt: Date.now() - 2_500 };
      render(<AgentCard agent={streaming} onKill={vi.fn()} />);
      expect(screen.getByTestId('agent-state')).toHaveTextContent('Working');
    });
  });

  describe('quiet state', () => {
    it('reads as waiting when a running agent has gone quiet', () => {
      render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
      expect(screen.getByTestId('agent-state')).toHaveTextContent('Waiting');
    });

    it('does not also claim to be working', () => {
      render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
      expect(screen.getByTestId('agent-state')).not.toHaveTextContent('Working');
    });

    it('never calls a finished agent waiting', () => {
      render(<AgentCard agent={idleAgent} onKill={vi.fn()} />);
      expect(screen.getByTestId('agent-state')).toHaveTextContent('Done');
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
  it('says how long a working agent has been running', () => {
    render(
      <AgentCard
        agent={{
          ...runningAgent,
          startedAt: Date.now() - 5 * 60_000,
          lastActivityAt: Date.now(),
        }}
        onKill={vi.fn()}
      />
    );
    expect(screen.getByTestId('agent-runtime')).toHaveTextContent('5m');
  });

  it('switches to how long it has been quiet once it stops producing', () => {
    // Five seconds of thinking and twenty minutes of waiting on an unanswered
    // question look identical without this, and while an agent is quiet the
    // silence is the more useful of the two numbers.
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
    expect(screen.getByTestId('agent-runtime')).toHaveTextContent('quiet 7m');
  });

  it('shows one duration, never two', () => {
    // Two bare numbers on one card read as a mistake — and on a fresh agent
    // they are literally the same number.
    render(
      <AgentCard
        agent={{
          ...runningAgent,
          startedAt: Date.now() - 17_000,
          lastActivityAt: Date.now() - 17_000,
        }}
        onKill={vi.fn()}
      />
    );
    expect(screen.getAllByTestId('agent-runtime')).toHaveLength(1);
  });

  it('falls back to runtime before the agent has produced anything', () => {
    // With no activity yet there is no silence to measure — claiming one
    // would be inventing a number.
    render(
      <AgentCard agent={{ ...runningAgent, startedAt: Date.now() - 3 * 60_000 }} onKill={vi.fn()} />
    );
    const runtime = screen.getByTestId('agent-runtime');
    expect(runtime).toHaveTextContent('3m');
    expect(runtime).not.toHaveTextContent('quiet');
  });

  it('does not run a clock on an agent that has stopped', () => {
    render(<AgentCard agent={{ ...idleAgent, startedAt: Date.now() - 60_000 }} onKill={vi.fn()} />);
    expect(screen.queryByTestId('agent-runtime')).not.toBeInTheDocument();
  });
});

describe('AgentCard – saying each thing once', () => {
  it('drops the objective when the name already is it', () => {
    // Names are derived from the instruction, so the two were the same text
    // twice — once truncated at the top, once in full below it.
    render(
      <AgentCard agent={{ ...runningAgent, name: 'Writing documentation' }} onKill={vi.fn()} />
    );
    expect(screen.getAllByText(/Writing documentation/)).toHaveLength(1);
  });

  it('keeps the objective when it says more than the name', () => {
    render(<AgentCard agent={{ ...runningAgent, name: 'Docs sweep' }} onKill={vi.fn()} />);
    expect(screen.getByText('Writing documentation')).toBeInTheDocument();
  });

  it('drops the objective when the name is its elided form', () => {
    render(<AgentCard agent={{ ...runningAgent, name: 'Writing docu…' }} onKill={vi.fn()} />);
    expect(screen.queryByText('Writing documentation')).not.toBeInTheDocument();
  });

  it('keeps the full instruction reachable as a tooltip', () => {
    render(
      <AgentCard agent={{ ...runningAgent, name: 'Writing documentation' }} onKill={vi.fn()} />
    );
    expect(screen.getByRole('heading', { name: 'Writing documentation' })).toHaveAttribute(
      'title',
      expect.stringContaining('Writing documentation')
    );
  });

  it('never wraps the name onto a second line', () => {
    render(
      <AgentCard
        agent={{ ...runningAgent, name: 'A very long agent name that would wrap' }}
        onKill={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { level: 3 })).toHaveClass('truncate');
  });

  it('keeps the state chip on one line', () => {
    // "Idle 17s" wrapping inside a rounded pill turned it into a circle.
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.getByTestId('agent-state').className).toContain('whitespace-nowrap');
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

describe('AgentCard – replying from the card', () => {
  async function openTerminal(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Show Terminal' }));
    return screen.getByPlaceholderText('Reply to agent...');
  }

  it('does not open the agent fullscreen when clicking into the reply field', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} onSelect={onSelect} />);

    const input = await openTerminal(user);
    onSelect.mockClear();
    await user.click(input);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not open the agent fullscreen when selecting log text', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} onSelect={onSelect} />);

    await openTerminal(user);
    onSelect.mockClear();
    await user.click(screen.getByTestId('agent-log-preview'));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('sends the reply to the agent on Enter and clears the field', async () => {
    const user = userEvent.setup();
    const { writeToShell } = await import('@/lib/tauri/terminal');
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);

    const input = await openTerminal(user);
    await user.type(input, 'yes{Enter}');

    expect(writeToShell).toHaveBeenCalledWith('agent-agent-1', 'yes\n');
    expect(input).toHaveValue('');
  });

  it('sends nothing for an empty reply', async () => {
    const user = userEvent.setup();
    const { writeToShell } = await import('@/lib/tauri/terminal');
    vi.mocked(writeToShell).mockClear();
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);

    const input = await openTerminal(user);
    await user.type(input, '{Enter}');

    expect(writeToShell).not.toHaveBeenCalled();
  });

  it('keeps the text and says so when the agent cannot be reached', async () => {
    const user = userEvent.setup();
    const { writeToShell } = await import('@/lib/tauri/terminal');
    vi.mocked(writeToShell).mockRejectedValueOnce(new Error('no such session'));
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);

    const input = await openTerminal(user);
    await user.type(input, 'yes{Enter}');

    // Silently swallowing the message would leave the user believing the
    // agent had been answered.
    expect(await screen.findByText(/could not be delivered/i)).toBeInTheDocument();
    expect(input).toHaveValue('yes');
  });
});

describe('AgentCard – attention escalation on the surface', () => {
  it('paints a blocked card amber, not just its chip', () => {
    // At arm's length the chip is 9px — the card surface itself must read
    // different from ordinary thinking when the agent waits on a human.
    const { container } = render(
      <AgentCard agent={{ ...makeLiveAgent(), awaitingInput: true }} onKill={vi.fn()} />
    );
    expect(container.firstElementChild?.className).toContain('border-amber');
  });

  it('keeps the terminate control visible to keyboard focus', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Terminate Agent' }).className).toContain(
      'focus-visible:opacity-100'
    );
  });
});

describe('AgentCard – nudging a stalled agent', () => {
  const stalled: AgentInfo = {
    ...runningAgent,
    id: 'agent-stalled',
    lastActivityAt: Date.now() - 10 * 60_000,
  };

  it('offers a nudge once the agent reads as stalled', () => {
    render(<AgentCard agent={stalled} onKill={vi.fn()} />);
    expect(screen.getByRole('button', { name: /nudge/i })).toBeInTheDocument();
  });

  it('sends a bare Enter to the PTY — the commonest unstick', async () => {
    const user = userEvent.setup();
    const { writeToShell } = await import('@/lib/tauri/terminal');
    vi.mocked(writeToShell).mockClear();
    render(<AgentCard agent={stalled} onKill={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /nudge/i }));
    expect(writeToShell).toHaveBeenCalledWith('agent-agent-stalled', '\n');
  });

  it('offers no nudge while the agent is merely waiting', () => {
    // Waiting is normal; poking a thinking agent would interleave stray
    // input with its work.
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /nudge/i })).not.toBeInTheDocument();
  });

  it('does not select the card when nudging', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AgentCard agent={stalled} onKill={vi.fn()} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: /nudge/i }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('AgentCard – quick reply while blocked on input', () => {
  const blocked: AgentInfo = { ...makeLiveAgent(), awaitingInput: true };

  it('offers the reply field right in the status view', () => {
    // Answering a prompt is THE next action on a blocked agent — requiring
    // a switch to the terminal view first was one hop of pure friction.
    render(<AgentCard agent={blocked} onKill={vi.fn()} />);
    expect(screen.getByPlaceholderText('Reply to agent...')).toBeInTheDocument();
  });

  it('sends the quick reply to the agent PTY', async () => {
    const user = userEvent.setup();
    const { writeToShell } = await import('@/lib/tauri/terminal');
    vi.mocked(writeToShell).mockClear();
    render(<AgentCard agent={blocked} onKill={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('Reply to agent...'), '1{Enter}');
    expect(writeToShell).toHaveBeenCalledWith('agent-agent-live', '1\n');
  });

  it('shows no quick reply while the agent is merely working', () => {
    render(<AgentCard agent={makeLiveAgent()} onKill={vi.fn()} />);
    expect(screen.queryByPlaceholderText('Reply to agent...')).not.toBeInTheDocument();
  });

  it('does not select the card when clicking into the quick reply', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AgentCard agent={blocked} onKill={vi.fn()} onSelect={onSelect} />);

    await user.click(screen.getByPlaceholderText('Reply to agent...'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('AgentCard – marker colour', () => {
  it('shows no marker on an unmarked agent', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} />);
    expect(screen.queryByTestId('agent-color-marker')).not.toBeInTheDocument();
  });

  it('marks the card along its edge', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} color="red" />);
    const marker = screen.getByTestId('agent-color-marker');
    expect(marker).toHaveStyle({ backgroundColor: '#ff6b6b' });
  });

  it('names the colour for assistive technology', () => {
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} color="green" />);
    expect(screen.getByLabelText('Marked Green')).toBeInTheDocument();
  });

  it('leaves the state chip alone — a marker must not read as status', () => {
    // Status already owns amber, emerald, red and the accent. A user marker
    // painted into the same slot would quietly change what the card claims.
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} color="green" />);
    expect(screen.getByTestId('agent-state')).toHaveTextContent('Waiting');
  });

  it('offers the colour menu on right-click', async () => {
    const user = userEvent.setup();
    const onContextMenu = vi.fn();
    render(<AgentCard agent={runningAgent} onKill={vi.fn()} onContextMenu={onContextMenu} />);

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Writer') });
    expect(onContextMenu).toHaveBeenCalledWith(expect.anything(), 'agent-1');
  });
});
