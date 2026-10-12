import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AgentTerminalModal } from './AgentTerminalModal';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';

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
  screen.getAllByTestId(/^terminal-pane-(?!remove-)/).map((pane) => pane.dataset.testid);

describe('AgentTerminalModal – terminals side by side', () => {
  beforeEach(() => {
    mockFocus.mockClear();
    useStore.setState({ terminalGridCells: null });
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

  it('a drop on the middle shows that terminal alone again', () => {
    renderModal();
    dragTab('b', 0.9, 0.5);
    dragTab('a', 0.5, 0.5);
    expect(paneIds()).toEqual(['terminal-pane-a']);
    expect(useStore.getState().terminalGridCells).toBeNull();
  });

  it('an agent that is gone gives its pane up', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'c', 'd'] });
    renderModal(AGENTS.filter((agent) => agent.id !== 'c'));
    expect(paneIds()).toEqual(['terminal-pane-a', 'terminal-pane-b', 'terminal-pane-d']);
  });
});
