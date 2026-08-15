import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrchestrationModal } from './OrchestrationModal';

const storeState = {
  orchestrationOpen: true,
  setOrchestrationOpen: vi.fn(),
  goalsDraft: [],
  pmDraftTickets: [],
  agents: [],
  goalRunsDraft: [],
  conductorRunning: false,
  setSelectedGoalId: vi.fn(),
  setGoalsModalOpen: vi.fn(),
  workPlaceOpen: false,
  overlayStack: { layers: [] as { id: string; kind: string }[] },
  pushOverlay: (entry: { id: string; kind: string }) => {
    const stack = storeState.overlayStack;
    if (stack.layers.some((layer) => layer.id === entry.id)) return;
    storeState.overlayStack = { layers: [...stack.layers, entry] };
  },
  removeOverlay: (id: string) => {
    storeState.overlayStack = {
      layers: storeState.overlayStack.layers.filter((layer) => layer.id !== id),
    };
  },
  ownsEscape: (id: string) => storeState.overlayStack.layers.at(-1)?.id === id,
};

vi.mock('@/lib/store', () => ({
  useStore: Object.assign((selector: (s: typeof storeState) => unknown) => selector(storeState), {
    getState: () => storeState,
  }),
}));

describe('OrchestrationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.overlayStack = { layers: [] };
    storeState.orchestrationOpen = true;
    storeState.workPlaceOpen = false;
  });

  it('exposes an accessible dialog', () => {
    render(<OrchestrationModal />);
    expect(screen.getByRole('dialog', { name: /work map/i })).toBeInTheDocument();
  });

  it('reopens Goals when closed so it does not sit on a leftover Goals owner', async () => {
    const user = userEvent.setup();
    render(<OrchestrationModal />);
    await user.click(screen.getByTestId('orchestration-close-btn'));
    expect(storeState.setOrchestrationOpen).toHaveBeenCalledWith(false);
    expect(storeState.setGoalsModalOpen).toHaveBeenCalledWith(true);
  });

  it('reopens Goals on Escape', () => {
    render(<OrchestrationModal />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(storeState.setOrchestrationOpen).toHaveBeenCalledWith(false);
    expect(storeState.setGoalsModalOpen).toHaveBeenCalledWith(true);
  });

  it('does not reopen the Goals overlay when Work already hosts Goals', async () => {
    storeState.workPlaceOpen = true;
    const user = userEvent.setup();
    render(<OrchestrationModal />);
    await user.click(screen.getByTestId('orchestration-close-btn'));
    expect(storeState.setOrchestrationOpen).toHaveBeenCalledWith(false);
    expect(storeState.setGoalsModalOpen).not.toHaveBeenCalled();
  });
});
