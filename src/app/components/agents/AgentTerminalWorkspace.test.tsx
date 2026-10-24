import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ComponentProps } from 'react';
import { AgentTerminalWorkspace } from './AgentTerminalWorkspace';
import type { AgentInfo } from '@/lib/tauri/agents';
import { setAppConfigValue } from '@/lib/config/appConfig';
import { useStore } from '@/lib/store';

vi.mock('./AgentXterm', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    AgentXterm: forwardRef(function AgentXterm({ agentId }: { agentId: string }, ref) {
      useImperativeHandle(ref, () => ({
        visibleText: () => `screen of ${agentId}`,
        focus: () => {},
      }));
      return <div data-testid={`xterm-${agentId}`} />;
    }),
  };
});

const running: AgentInfo = {
  id: 'a',
  name: 'Alpha',
  model: 'model',
  provider: 'claude',
  status: 'running',
  startedAt: 1000,
  lastActivityAt: Date.now(),
};
const finished: AgentInfo = { ...running, id: 'b', name: 'Beta', status: 'idle' };

type WorkspaceProps = ComponentProps<typeof AgentTerminalWorkspace>;

function renderWorkspace(props: Partial<WorkspaceProps> = {}) {
  const confirm = vi.fn(async () => true);
  const onEndAgent = vi.fn(async () => {});
  const onClose = vi.fn();
  const onSwitchAgent = vi.fn();
  render(
    <AgentTerminalWorkspace
      agent={running}
      agents={[running, finished]}
      onSwitchAgent={onSwitchAgent}
      onClose={onClose}
      confirm={confirm}
      onEndAgent={onEndAgent}
      {...props}
    />
  );
  return { confirm, onEndAgent, onClose, onSwitchAgent };
}

describe('AgentTerminalWorkspace – outside the modal', () => {
  beforeEach(() => {
    useStore.setState({ terminalGridCells: null });
  });
  afterEach(() => {
    useStore.setState({ terminalGridCells: null, overlayStack: { layers: [] } });
  });

  it('a layout button puts the first tabs into the panes and focuses the first one', async () => {
    const user = userEvent.setup();
    const third: AgentInfo = { ...running, id: 'c', name: 'Gamma' };
    const fourth: AgentInfo = { ...running, id: 'd', name: 'Delta' };
    const { onSwitchAgent } = renderWorkspace({
      agent: fourth,
      agents: [running, finished, third, fourth],
    });
    await user.click(
      screen.getByRole('button', { name: 'Show 3 terminals side by side, supervisors first' })
    );
    expect(useStore.getState().terminalGridCells).toEqual(['a', 'b', 'a', 'c']);
    expect(onSwitchAgent).toHaveBeenCalledWith(running);
  });

  it('a layout button seats the supervisor even when its tab is not in front', async () => {
    const user = userEvent.setup();
    const third: AgentInfo = { ...running, id: 'c', name: 'Gamma' };
    const boss: AgentInfo = { ...running, id: 's', name: 'Boss', role: 'supervisor' };
    renderWorkspace({ agents: [running, finished, third, boss] });
    await user.click(
      screen.getByRole('button', { name: 'Show 2 terminals side by side, supervisors first' })
    );
    expect(useStore.getState().terminalGridCells).toEqual(['s', 'a', 's', 'a']);
  });

  it('offers a layout only when there are enough tabs to fill it', () => {
    renderWorkspace();
    expect(
      screen.getByRole('button', { name: 'Show 2 terminals side by side, supervisors first' })
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Show 4 terminals side by side, supervisors first' })
    ).toBeDisabled();
  });

  it('offers no timeline for an agent outside a supervisor family', () => {
    renderWorkspace();
    expect(screen.queryByRole('button', { name: 'Show agent timeline' })).not.toBeInTheDocument();
  });

  it('shows no layout buttons for a single agent', () => {
    renderWorkspace({ agents: [running] });
    expect(screen.queryByRole('group', { name: 'Terminal layout' })).not.toBeInTheDocument();
  });

  it('brings no dialog and no backdrop of its own', () => {
    renderWorkspace();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-modal-backdrop')).not.toBeInTheDocument();
    expect(useStore.getState().overlayStack.layers).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByTestId('xterm-a')).toBeInTheDocument();
  });

  it('asks before ending a running agent, leaves its tab, then ends it once', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    let answer: (go: boolean) => void = () => {};
    const confirm = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const onSwitchAgent = vi.fn(() => order.push('switched'));
    const onEndAgent = vi.fn(async () => {
      order.push('ended');
    });
    renderWorkspace({ confirm, onEndAgent, onSwitchAgent });

    await user.click(screen.getByTestId('agent-tab-close-a'));

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stop this agent?' }));
    expect(onEndAgent).not.toHaveBeenCalled();

    answer(true);
    await waitFor(() => expect(onEndAgent).toHaveBeenCalledTimes(1));
    expect(onEndAgent).toHaveBeenCalledWith(running);
    expect(onSwitchAgent).toHaveBeenCalledWith(finished);
    expect(order).toEqual(['switched', 'ended']);
  });

  it('ends nothing when the question is answered with no', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(async () => false);
    const { onEndAgent, onSwitchAgent } = renderWorkspace({ confirm });

    await user.click(screen.getByTestId('agent-tab-close-a'));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(onEndAgent).not.toHaveBeenCalled();
    expect(onSwitchAgent).not.toHaveBeenCalled();
  });

  it('ends a finished agent without asking', async () => {
    const user = userEvent.setup();
    const { confirm, onEndAgent } = renderWorkspace();

    await user.click(screen.getByTestId('agent-tab-close-b'));

    await waitFor(() => expect(onEndAgent).toHaveBeenCalledTimes(1));
    expect(onEndAgent).toHaveBeenCalledWith(finished);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a pane’s X ends the agent exactly like the tab’s X; the split control only takes it out', async () => {
    const user = userEvent.setup();
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    const { confirm, onEndAgent } = renderWorkspace({ agents: [running, finished] });

    await user.click(screen.getByTestId('terminal-pane-remove-b'));
    expect(onEndAgent).not.toHaveBeenCalled();
    expect(useStore.getState().terminalGridCells).toBeNull();

    act(() => useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] }));
    await user.click(screen.getByTestId('terminal-pane-end-b'));
    await waitFor(() => expect(onEndAgent).toHaveBeenCalledWith(finished));
    expect(confirm).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('terminal-pane-end-a'));
    expect(confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onEndAgent).toHaveBeenCalledWith(running));
  });

  it('offers no end control on a pane where the shell allows none', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderWorkspace({ canEndAgent: (target) => target.id !== 'b' });
    expect(screen.queryByTestId('terminal-pane-end-b')).not.toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-end-a')).toBeInTheDocument();
  });

  it('closes when the last tab is ended', async () => {
    const user = userEvent.setup();
    const { onClose, onEndAgent } = renderWorkspace({ agents: [running] });

    await user.click(screen.getByTestId('agent-tab-close-a'));

    await waitFor(() => expect(onEndAgent).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers an end control only where the shell allows one', () => {
    renderWorkspace({ canEndAgent: (target) => target.id === 'b' });
    expect(screen.queryByTestId('agent-tab-close-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('agent-tab-close-b')).toBeInTheDocument();
  });

  it('hands the save to the shell with the agent name and a way to read the screen', async () => {
    const user = userEvent.setup();
    const onSaveScreen = vi.fn(async (_name: string, _read: () => string | null) => {});
    renderWorkspace({ onSaveScreen });

    await user.click(screen.getByTestId('agent-tab-capture-a'));

    expect(onSaveScreen).toHaveBeenCalledTimes(1);
    const [name, readScreen] = onSaveScreen.mock.calls[0];
    expect(name).toBe('Alpha');
    expect(readScreen()).toBe('screen of a');
  });

  it('offers no save control when the shell cannot save', () => {
    renderWorkspace();
    expect(screen.queryByTestId('agent-tab-capture-a')).not.toBeInTheDocument();
  });

  it('renders the shell’s header actions before the close control', () => {
    renderWorkspace({ headerActions: <button>Dock</button>, closeLabel: 'Close window' });
    const dock = screen.getByRole('button', { name: 'Dock' });
    const close = screen.getByTitle('Close window');
    expect(dock.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(close).toHaveAccessibleName('Close window');
  });

  it('calls onClose from the close control', async () => {
    const user = userEvent.setup();
    const { onClose } = renderWorkspace();
    await user.click(screen.getByTitle('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the error digest it is given', () => {
    renderWorkspace({ errorDigest: 'error: build failed' });
    expect(screen.getByTestId('terminal-error-digest')).toHaveTextContent('error: build failed');
  });

  it('passes extra attributes on to the header row', () => {
    renderWorkspace({ headerProps: { 'data-tauri-drag-region': true, className: 'pl-20' } });
    const header = screen
      .getByRole('heading', { name: 'Alpha' })
      .closest('[data-tauri-drag-region]');
    expect(header).toHaveClass('pl-20', 'glass');
  });
});

describe('AgentTerminalWorkspace – supervisor families', () => {
  const now = Date.now();
  const base = { model: 'model', provider: 'claude', status: 'running' as const, startedAt: 1 };
  const mail: AgentInfo = {
    ...base,
    id: 'sup-mail',
    name: 'Supervisor',
    role: 'supervisor',
    supervisorKey: 'mail-triage',
    lastActivityAt: now,
  };
  const research: AgentInfo = {
    ...base,
    id: 'sup-research',
    name: 'Supervisor 2',
    role: 'supervisor',
    lastActivityAt: now,
  };
  const child = (id: string, parent: string, repo: string): AgentInfo => ({
    ...base,
    id,
    name: `Child ${id}`,
    repoPath: `/work/${repo}`,
    spawnedByAgentId: parent,
    lastActivityAt: now,
  });
  const fleet: AgentInfo[] = [
    mail,
    child('m1', 'sup-mail', 'repo-a'),
    research,
    child('r1', 'sup-research', 'repo-a'),
    child('m2', 'sup-mail', 'repo-b'),
    child('r2', 'sup-research', 'repo-b'),
    { ...base, id: 'plain', name: 'Plain', repoPath: '/work/repo-a', lastActivityAt: now },
  ];
  const accentOf = (id: string) => screen.queryByTestId(`agent-tab-accent-${id}`)?.dataset.accent;
  const setAlt = (held: boolean) =>
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent(held ? 'keydown' : 'keyup', { key: 'Alt', altKey: held })
      );
    });

  beforeEach(() => {
    useStore.setState({ terminalGridCells: null, agentColors: {} });
  });
  afterEach(() => {
    setAlt(false);
    useStore.setState({ terminalGridCells: null, overlayStack: { layers: [] }, agentColors: {} });
  });

  it('groups each family under its key or name, the supervisor first, whatever the repo', () => {
    renderWorkspace({ agent: mail, agents: fleet });
    const mailGroup = screen.getByTestId('agent-tab-group-supervisor:sup-mail');
    expect(mailGroup).toHaveTextContent(/^mail-triage/);
    expect(
      within(mailGroup)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual([
      expect.stringContaining('Supervisor'),
      expect.stringContaining('Child m1'),
      expect.stringContaining('Child m2'),
    ]);
    expect(screen.getByTestId('agent-tab-group-supervisor:sup-research')).toHaveTextContent(
      /^Supervisor 2/
    );
    expect(screen.getByTestId('agent-tab-group-/work/repo-a')).toHaveTextContent('Plain');
  });

  it('shows the family colour without Alt: one per family, none outside a family', () => {
    renderWorkspace({ agent: mail, agents: fleet });
    expect(accentOf('sup-mail')).toBeDefined();
    expect(accentOf('m1')).toBe(accentOf('sup-mail'));
    expect(accentOf('m2')).toBe(accentOf('sup-mail'));
    expect(accentOf('r1')).toBe(accentOf('sup-research'));
    expect(accentOf('sup-research')).not.toBe(accentOf('sup-mail'));
    expect(accentOf('plain')).toBeUndefined();
    expect(screen.getByTestId('agent-tab-group-supervisor:sup-mail').dataset.accent).toBe(
      accentOf('sup-mail')
    );
  });

  it('gives every agent its own colour while Alt is held', () => {
    renderWorkspace({ agent: mail, agents: fleet });
    setAlt(true);
    const colours = fleet.map((a) => accentOf(a.id));
    expect(colours.every(Boolean)).toBe(true);
    expect(new Set(colours).size).toBe(fleet.length);
  });

  it.each([
    ['the next tab of its family', 'm1', 'm2'],
    ['the previous tab of its family when it was the last one', 'm2', 'm1'],
  ])('closing a family tab lands on %s', async (_, closing, expected) => {
    const user = userEvent.setup();
    const active = fleet.find((a) => a.id === closing)!;
    const { onSwitchAgent, onEndAgent } = renderWorkspace({ agent: active, agents: fleet });

    await user.click(screen.getByTestId(`agent-tab-close-${closing}`));

    await waitFor(() => expect(onEndAgent).toHaveBeenCalledWith(active));
    expect(onSwitchAgent).toHaveBeenCalledWith(expect.objectContaining({ id: expected }));
  });

  it('folds a timeline of this supervisor’s agents down from the header', async () => {
    const user = userEvent.setup();
    const started = Date.now();
    const sup: AgentInfo = {
      ...mail,
      startedAt: started - 60_000,
      lastActivityAt: started,
    };
    const child: AgentInfo = {
      ...base,
      id: 'kid',
      name: 'Writer',
      model: 'sonnet',
      spawnedByAgentId: 'sup-mail',
      startedAt: started - 30_000,
      lastActivityAt: started,
      currentTask: 'Draft the pricing page',
    };
    const { onSwitchAgent } = renderWorkspace({ agent: sup, agents: [sup, child] });

    expect(screen.queryByTestId('supervisor-timeline')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show agent timeline' }));

    const panel = screen.getByTestId('supervisor-timeline');
    expect(panel).toHaveTextContent('Writer');
    expect(panel).toHaveTextContent('Draft the pricing page');
    await user.click(within(panel).getByRole('button', { name: 'Show Writer' }));
    expect(onSwitchAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'kid' }));

    await user.click(screen.getByRole('button', { name: 'Hide agent timeline' }));
    expect(screen.queryByTestId('supervisor-timeline')).not.toBeInTheDocument();
  });

  it('offers the same timeline from a child of the supervisor', () => {
    const started = Date.now();
    const sup: AgentInfo = { ...mail, startedAt: started, lastActivityAt: started };
    const child: AgentInfo = {
      ...base,
      id: 'kid',
      name: 'Writer',
      spawnedByAgentId: 'sup-mail',
      startedAt: started,
      lastActivityAt: started,
    };
    renderWorkspace({ agent: child, agents: [sup, child] });
    expect(screen.getByRole('button', { name: 'Show agent timeline' })).toBeInTheDocument();
  });

  it('a family pane keeps the project it works in', () => {
    useStore.setState({ terminalGridCells: ['sup-mail', 'm2', 'r1', 'plain'] });
    renderWorkspace({ agent: mail, agents: fleet });
    expect(screen.getByTestId('terminal-pane-project-m2')).toHaveTextContent('repo-b');
    expect(screen.getByTestId('terminal-pane-m2').dataset.accent).toBe(accentOf('sup-mail'));
  });

  it('focus mode hides non-supervisor tabs and panes while keeping the timeline intact, and restores them when turned off', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    useStore.setState({ terminalGridCells: ['sup-mail', 'm1', 'sup-research', 'r1'] });

    function StatefulWorkspace() {
      const [active, setActive] = useState<AgentInfo>(fleet[1]); // m1 (a child)
      return (
        <AgentTerminalWorkspace
          agent={active}
          agents={fleet}
          onSwitchAgent={setActive}
          onClose={() => {}}
          confirm={async () => true}
        />
      );
    }

    render(<StatefulWorkspace />);

    // Before focus mode: all 7 tabs and 4 panes are visible
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(screen.getByTestId('terminal-pane-m1')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-r1')).toBeInTheDocument();

    const toggle = screen.getByTestId('supervisor-focus-mode-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Turn focus mode ON
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // Only supervisor tabs remain in the strip
    const tabsOn = screen.getAllByRole('tab');
    expect(tabsOn).toHaveLength(2);
    expect(screen.getByTestId('agent-tab-sup-mail')).toBeInTheDocument();
    expect(screen.getByTestId('agent-tab-sup-research')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-tab-m1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-tab-plain')).not.toBeInTheDocument();

    // Active agent was child m1 -> switches to its root supervisor (sup-mail)
    expect(screen.getByRole('heading', { name: 'Supervisor' })).toBeInTheDocument();

    // Terminal grid shows only the supervisors, without overwriting the stored 4-pane grid
    expect(screen.getByTestId('terminal-pane-sup-mail')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-sup-research')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-pane-m1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('terminal-pane-r1')).not.toBeInTheDocument();
    expect(useStore.getState().terminalGridCells).toEqual(['sup-mail', 'm1', 'sup-research', 'r1']);

    // Timeline still shows all family members including hidden children
    await user.click(screen.getByRole('button', { name: 'Show agent timeline' }));
    const timeline = screen.getByTestId('supervisor-timeline');
    expect(timeline).toHaveTextContent('Child m1');
    expect(timeline).toHaveTextContent('Child m2');

    // Turn focus mode OFF -> restores all tabs and the original 4-pane grid placement
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(screen.getByTestId('terminal-pane-sup-mail')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-m1')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-sup-research')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-r1')).toBeInTheDocument();
  });

  it('starts in focus mode when the application setting is enabled and switches active child to its supervisor', () => {
    setAppConfigValue('agentTerminalFocusMode', true);
    const { onSwitchAgent } = renderWorkspace({ agent: fleet[1], agents: fleet });

    const toggle = screen.getByTestId('supervisor-focus-mode-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.queryByTestId('agent-tab-m1')).not.toBeInTheDocument();
    expect(onSwitchAgent).toHaveBeenCalledWith(mail);
    localStorage.clear();
  });

  it('auto-arrange ignores newly spawned non-supervisor children while focus mode is on', () => {
    setAppConfigValue('agentTerminalFocusMode', true);
    const view = render(
      <AgentTerminalWorkspace
        agent={mail}
        agents={[mail]}
        onSwitchAgent={() => {}}
        onClose={() => {}}
        confirm={async () => true}
      />
    );
    expect(useStore.getState().terminalGridCells).toBeNull();

    view.rerender(
      <AgentTerminalWorkspace
        agent={mail}
        agents={[mail, fleet[1]]}
        onSwitchAgent={() => {}}
        onClose={() => {}}
        confirm={async () => true}
      />
    );
    expect(useStore.getState().terminalGridCells).toBeNull();
    localStorage.clear();
  });
});
