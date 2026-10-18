import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AgentTerminalModal } from './AgentTerminalModal';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { setAppConfigValue } from '@/lib/config/appConfig';

const mockFocus = vi.fn();

vi.mock('./AgentXterm', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    AgentXterm: forwardRef(function AgentXterm(
      { agentId, autoFocus = true }: { agentId: string; autoFocus?: boolean },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        visibleText: () => '',
        focus: () => mockFocus(agentId),
      }));
      return <div data-testid={`xterm-${agentId}`} data-autofocus={autoFocus} />;
    }),
  };
});

function makeAgent(id: string, name: string): AgentInfo {
  return {
    id,
    name,
    model: 'model',
    provider: 'claude',
    status: 'running',
    startedAt: 1000,
    lastActivityAt: Date.now(),
  };
}

const AGENTS = [
  makeAgent('a', 'Alpha'),
  makeAgent('b', 'Beta'),
  makeAgent('c', 'Gamma'),
  makeAgent('d', 'Delta'),
];

const ALL_FIVE = [...AGENTS, makeAgent('e', 'Epsilon')];

const AREA = { left: 0, top: 100, width: 1000, height: 600 };

/** The modal with the caller's half of the wiring: the active agent follows onSwitchAgent. */
function Harness({ onClose, agents = AGENTS }: { onClose: () => void; agents?: AgentInfo[] }) {
  const [active, setActive] = useState<AgentInfo>(agents[0]);
  return (
    <AgentTerminalModal
      agent={active}
      agents={agents}
      onSwitchAgent={setActive}
      onClose={onClose}
    />
  );
}

function renderModal(agents?: AgentInfo[]) {
  const onClose = vi.fn();
  const view = render(<Harness onClose={onClose} agents={agents} />);
  const area = screen.getByTestId('terminal-grid');
  area.getBoundingClientRect = () =>
    ({
      ...AREA,
      right: AREA.left + AREA.width,
      bottom: AREA.top + AREA.height,
      x: AREA.left,
      y: AREA.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return { onClose, ...view };
}

/** Press on a tab, move to a point given as a share of the terminal area, release. */
function dragTab(agentId: string, fx: number, fy: number, release = true) {
  const tab = screen.getByTestId(`agent-tab-${agentId}`);
  fireEvent.mouseDown(tab, { button: 0, clientX: 50, clientY: 80 });
  fireEvent.mouseMove(window, {
    clientX: AREA.left + fx * AREA.width,
    clientY: AREA.top + fy * AREA.height,
  });
  if (release) {
    fireEvent.mouseUp(window);
    fireEvent.click(tab);
  }
  return tab;
}

const paneIds = () =>
  screen
    .getAllByTestId(/^terminal-pane-(?!remove-|bar-|maximize-|end-)/)
    .map((pane) => pane.dataset.testid);

describe('AgentTerminalModal – terminals side by side', () => {
  beforeEach(() => {
    mockFocus.mockClear();
    localStorage.clear();
    useStore.setState({ terminalGridCells: null, agentColors: {} });
  });
  afterEach(() => {
    useStore.setState({ terminalGridCells: null, overlayStack: { layers: [] } });
  });

  it('opens with one terminal and no pane header', () => {
    renderModal();
    expect(paneIds()).toEqual(['terminal-pane-a']);
    expect(screen.queryByTestId('terminal-pane-remove-a')).not.toBeInTheDocument();
  });

  it('a tab dragged to the right edge opens beside the terminal that was showing', () => {
    renderModal();
    dragTab('b', 0.9, 0.5);

    expect(paneIds()).toEqual(['terminal-pane-a', 'terminal-pane-b']);
    expect(useStore.getState().terminalGridCells).toEqual(['a', 'b', 'a', 'b']);
    // The dropped terminal is the one the user is now working in.
    expect(screen.getByTestId('terminal-pane-b')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('agent-tab-b')).toHaveAttribute('aria-selected', 'true');
  });

  it('the terminal that is showing can be dragged to a half; the next tab fills the rest', () => {
    renderModal();
    dragTab('a', 0.1, 0.5);

    expect(useStore.getState().terminalGridCells).toEqual(['a', 'b', 'a', 'b']);
    expect(paneIds()).toEqual(['terminal-pane-a', 'terminal-pane-b']);
    expect(screen.getByTestId('terminal-pane-a')).toHaveAttribute('data-active', 'true');
  });

  it('with one agent only there is nothing to arrange, so a drag starts nothing', () => {
    renderModal([AGENTS[0]]);
    dragTab('a', 0.1, 0.5, false);
    expect(screen.queryByTestId('terminal-grid-drop-preview')).not.toBeInTheDocument();
    fireEvent.mouseUp(window);
    expect(useStore.getState().terminalGridCells).toBeNull();
  });

  it('corner drops fill a grid of four', () => {
    renderModal();
    dragTab('b', 0.1, 0.1);
    dragTab('c', 0.1, 0.9);
    dragTab('d', 0.9, 0.9);

    expect(useStore.getState().terminalGridCells).toEqual(['b', 'a', 'c', 'd']);
    expect(paneIds()).toHaveLength(4);
  });

  it('shows where the tab would land while it is dragged', () => {
    renderModal();
    dragTab('b', 0.1, 0.5, false);
    expect(screen.getByTestId('terminal-grid-drop-preview')).toHaveAttribute('data-zone', 'left');
    expect(screen.getByText('Left half')).toBeInTheDocument();

    fireEvent.mouseUp(window);
    expect(screen.queryByTestId('terminal-grid-drop-preview')).not.toBeInTheDocument();
  });

  it('a release outside the terminal area drops nothing', () => {
    renderModal();
    dragTab('b', 0.5, -0.1);
    expect(useStore.getState().terminalGridCells).toBeNull();
    expect(paneIds()).toEqual(['terminal-pane-a']);
    // The click that ends the drag must not select the tab either.
    expect(screen.getByTestId('agent-tab-a')).toHaveAttribute('aria-selected', 'true');
  });

  it('a press that barely moves is still a click', () => {
    renderModal();
    const tab = screen.getByTestId('agent-tab-b');
    fireEvent.mouseDown(tab, { button: 0, clientX: 50, clientY: 80 });
    fireEvent.mouseMove(window, { clientX: 52, clientY: 81 });
    fireEvent.mouseUp(window);
    fireEvent.click(tab);

    expect(paneIds()).toEqual(['terminal-pane-b']);
    expect(useStore.getState().terminalGridCells).toBeNull();
  });

  it('Escape calls the drag off and leaves the terminal open', () => {
    const { onClose } = renderModal();
    dragTab('b', 0.9, 0.5, false);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('terminal-grid-drop-preview')).not.toBeInTheDocument();
    fireEvent.mouseUp(window);
    expect(useStore.getState().terminalGridCells).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a tab that is not on screen takes the focused pane, one that is only gets the focus', () => {
    renderModal();
    dragTab('b', 0.9, 0.5);

    fireEvent.click(screen.getByTestId('agent-tab-c'));
    expect(useStore.getState().terminalGridCells).toEqual(['a', 'c', 'a', 'c']);

    mockFocus.mockClear();
    fireEvent.click(screen.getByTestId('agent-tab-a'));
    expect(useStore.getState().terminalGridCells).toEqual(['a', 'c', 'a', 'c']);
    expect(screen.getByTestId('terminal-pane-a')).toHaveAttribute('data-active', 'true');
    expect(mockFocus).toHaveBeenCalledWith('a');
  });

  it('a click into a pane makes it the active one', () => {
    renderModal();
    dragTab('b', 0.9, 0.5);
    fireEvent.mouseDown(screen.getByTestId('xterm-a'));
    expect(screen.getByTestId('agent-tab-a')).toHaveAttribute('aria-selected', 'true');
  });

  it('only the active pane asks for the keyboard when it opens', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderModal();
    expect(screen.getByTestId('xterm-a')).toHaveAttribute('data-autofocus', 'true');
    expect(screen.getByTestId('xterm-b')).toHaveAttribute('data-autofocus', 'false');
  });

  it('taking a pane out gives its space to the neighbour and keeps the agent', () => {
    renderModal();
    dragTab('b', 0.9, 0.5);
    fireEvent.click(screen.getByTestId('terminal-pane-remove-b'));

    expect(paneIds()).toEqual(['terminal-pane-a']);
    expect(useStore.getState().terminalGridCells).toBeNull();
    expect(screen.getByTestId('agent-tab-b')).toBeInTheDocument();
    expect(screen.getByTestId('agent-tab-a')).toHaveAttribute('aria-selected', 'true');
  });

  it('a pane can be dragged by its bar to another place', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderModal();
    const bar = screen.getByTestId('terminal-pane-bar-a');
    fireEvent.mouseDown(bar, { button: 0, clientX: 100, clientY: 110 });
    fireEvent.mouseMove(window, {
      clientX: AREA.left + 0.9 * AREA.width,
      clientY: AREA.top + 0.5 * AREA.height,
    });
    expect(screen.getByTestId('terminal-grid-drop-preview')).toHaveAttribute('data-zone', 'right');
    fireEvent.mouseUp(window);

    expect(useStore.getState().terminalGridCells).toEqual(['b', 'a', 'b', 'a']);
  });

  it('a double-click on a pane bar lays that pane over the whole area, and back', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderModal();
    const bar = screen.getByTestId('terminal-pane-bar-b');
    fireEvent.doubleClick(bar);

    expect(screen.getByTestId('terminal-pane-b')).toHaveAttribute('data-maximized', 'true');
    expect(screen.getByTestId('terminal-pane-b')).toHaveAttribute('data-active', 'true');
    // The others stay mounted underneath, so their terminals keep their size.
    expect(screen.getByTestId('xterm-a')).toBeInTheDocument();
    // The layout itself is untouched.
    expect(useStore.getState().terminalGridCells).toEqual(['a', 'b', 'a', 'b']);

    fireEvent.doubleClick(bar);
    expect(screen.getByTestId('terminal-pane-b')).toHaveAttribute('data-maximized', 'false');
  });

  it('the maximize button does the same as the double-click', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderModal();
    fireEvent.click(screen.getByTestId('terminal-pane-maximize-a'));
    expect(screen.getByTestId('terminal-pane-a')).toHaveAttribute('data-maximized', 'true');
    fireEvent.click(screen.getByTestId('terminal-pane-maximize-a'));
    expect(screen.getByTestId('terminal-pane-a')).toHaveAttribute('data-maximized', 'false');
  });

  it('choosing another tab while a pane is maximized brings the split back', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderModal();
    fireEvent.doubleClick(screen.getByTestId('terminal-pane-bar-b'));

    const tab = screen.getByTestId('agent-tab-a');
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.click(tab);

    expect(screen.getByTestId('terminal-pane-b')).toHaveAttribute('data-maximized', 'false');
    expect(screen.getByTestId('terminal-pane-a')).toHaveAttribute('data-active', 'true');
  });

  it('a press anywhere outside the maximized pane brings the split back', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderModal();
    fireEvent.doubleClick(screen.getByTestId('terminal-pane-bar-b'));

    fireEvent.mouseDown(screen.getByTestId('terminal-grid'));
    expect(screen.getByTestId('terminal-pane-b')).toHaveAttribute('data-maximized', 'false');
  });

  it('pressing inside the maximized pane or on its own tab keeps it maximized', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderModal();
    fireEvent.doubleClick(screen.getByTestId('terminal-pane-bar-b'));

    fireEvent.mouseDown(screen.getByTestId('xterm-b'));
    const ownTab = screen.getByTestId('agent-tab-b');
    fireEvent.mouseDown(ownTab, { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.click(ownTab);

    expect(screen.getByTestId('terminal-pane-b')).toHaveAttribute('data-maximized', 'true');
  });

  it('a pane bar names the project the agent runs in', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderModal([
      { ...AGENTS[0], repoPath: '/work/alpha-app' },
      { ...AGENTS[1], repoPath: '/work/beta-site' },
    ]);
    expect(screen.getByTestId('terminal-pane-project-a')).toHaveTextContent('alpha-app');
    expect(screen.getByTestId('terminal-pane-project-b')).toHaveTextContent('beta-site');
    expect(screen.getByTestId('terminal-pane-bar-a')).toHaveTextContent('Alpha');
  });

  it('a pane bar for an agent without a project shows only its name', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderModal([AGENTS[0], AGENTS[1]]);
    expect(screen.queryByTestId('terminal-pane-project-a')).toBeNull();
  });

  it('a maximized pane taken out of the split leaves nothing maximized behind', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderModal();
    fireEvent.doubleClick(screen.getByTestId('terminal-pane-bar-b'));
    fireEvent.click(screen.getByTestId('terminal-pane-remove-b'));
    dragTab('b', 0.9, 0.5);
    expect(screen.getByTestId('terminal-pane-b')).toHaveAttribute('data-maximized', 'false');
  });

  it('a drop on the middle shows that terminal alone again', () => {
    renderModal();
    dragTab('b', 0.9, 0.5);
    dragTab('a', 0.5, 0.5);
    expect(paneIds()).toEqual(['terminal-pane-a']);
    expect(useStore.getState().terminalGridCells).toBeNull();
  });

  it('a second agent arriving puts the two side by side by itself', () => {
    const view = renderModal([AGENTS[0]]);
    expect(paneIds()).toEqual(['terminal-pane-a']);

    view.rerender(<Harness onClose={vi.fn()} agents={[AGENTS[0], AGENTS[1]]} />);

    expect(useStore.getState().terminalGridCells).toEqual(['a', 'b', 'a', 'b']);
    expect(paneIds()).toEqual(['terminal-pane-a', 'terminal-pane-b']);
    expect(screen.getByTestId('terminal-pane-a')).toHaveAttribute('data-active', 'true');
  });

  it('a modal that opens onto two agents is left as the user had it', () => {
    renderModal([AGENTS[0], AGENTS[1]]);
    expect(paneIds()).toEqual(['terminal-pane-a']);
    expect(useStore.getState().terminalGridCells).toBeNull();
  });

  it('the third and fourth take the bottom corners; the fifth stays a tab', () => {
    const view = renderModal([AGENTS[0]]);
    const show = (count: number) =>
      view.rerender(<Harness onClose={vi.fn()} agents={ALL_FIVE.slice(0, count)} />);
    show(2);
    show(3);
    expect(useStore.getState().terminalGridCells).toEqual(['a', 'b', 'a', 'c']);
    show(4);
    expect(useStore.getState().terminalGridCells).toEqual(['a', 'b', 'd', 'c']);
    show(5);
    expect(useStore.getState().terminalGridCells).toEqual(['a', 'b', 'd', 'c']);
    expect(screen.getByTestId('agent-tab-e')).toBeInTheDocument();
  });

  it('arranges nothing when the setting is off', () => {
    setAppConfigValue('agentTerminalAutoArrange', false);
    const view = renderModal([AGENTS[0]]);
    view.rerender(<Harness onClose={vi.fn()} agents={[AGENTS[0], AGENTS[1]]} />);
    expect(useStore.getState().terminalGridCells).toBeNull();
    expect(paneIds()).toEqual(['terminal-pane-a']);
  });

  const holdAlt = () =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    });

  it('wears no colour by default, and shows it while Alt is held', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'c', 'd'] });
    renderModal();
    expect(screen.queryByTestId('agent-tab-accent-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-a').dataset.accent).toBeUndefined();
    holdAlt();
    expect(screen.getByTestId('agent-tab-accent-a')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', altKey: false }));
    });
    expect(screen.queryByTestId('agent-tab-accent-a')).not.toBeInTheDocument();
  });

  it('gives every tab and pane of a fleet its own colour', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'c', 'd'] });
    renderModal();
    holdAlt();
    const tabColors = AGENTS.map((agent) =>
      screen.getByTestId(`agent-tab-accent-${agent.id}`).getAttribute('data-accent')
    );
    expect(new Set(tabColors).size).toBe(4);
    for (const agent of AGENTS) {
      expect(screen.getByTestId(`terminal-pane-${agent.id}`).dataset.accent).toBe(
        screen.getByTestId(`agent-tab-accent-${agent.id}`).dataset.accent
      );
    }
  });

  it('a marker the user set is the colour the tab and pane wear', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'], agentColors: { b: 'red' } });
    renderModal();
    holdAlt();
    expect(screen.getByTestId('agent-tab-accent-b').dataset.accent).toBe('#ff6b6b');
    expect(screen.getByTestId('terminal-pane-b').dataset.accent).toBe('#ff6b6b');
  });

  it('one agent alone wears no colour', () => {
    renderModal([AGENTS[0]]);
    expect(screen.queryByTestId('agent-tab-accent-a')).not.toBeInTheDocument();
  });

  it('taking a pane out is not undone by the next render', () => {
    const view = renderModal([AGENTS[0]]);
    view.rerender(<Harness onClose={vi.fn()} agents={[AGENTS[0], AGENTS[1]]} />);
    fireEvent.click(screen.getByTestId('terminal-pane-remove-b'));
    view.rerender(<Harness onClose={vi.fn()} agents={[AGENTS[0], AGENTS[1]]} />);
    expect(paneIds()).toEqual(['terminal-pane-a']);
  });

  it('marks the tabs that are on screen, only while the view is split', () => {
    renderModal();
    expect(screen.getByTestId('agent-tab-shell-a')).not.toHaveAttribute('data-in-view');
    dragTab('b', 0.9, 0.5);
    expect(screen.getByTestId('agent-tab-shell-a')).toHaveAttribute('data-in-view', 'true');
    expect(screen.getByTestId('agent-tab-shell-b')).toHaveAttribute('data-in-view', 'true');
    expect(screen.getByTestId('agent-tab-shell-c')).not.toHaveAttribute('data-in-view');
  });

  it('an agent that is gone gives its pane up', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'c', 'd'] });
    renderModal(AGENTS.filter((agent) => agent.id !== 'c'));
    expect(paneIds()).toEqual(['terminal-pane-a', 'terminal-pane-b', 'terminal-pane-d']);
  });
});
