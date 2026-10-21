import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAgentAndCommandHandlers,
  type UseAgentAndCommandHandlersProps,
} from './useAgentAndCommandHandlers';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';

const showAgentInWindow = vi.fn(async (_agentId: string): Promise<boolean> => true);

vi.mock('@/lib/agents/agentWindowHost', () => ({
  showAgentInWindow: (agentId: string) => showAgentInWindow(agentId),
}));

const agent: AgentInfo = {
  id: 'a',
  name: 'Alpha',
  model: 'model',
  provider: 'claude',
  status: 'idle',
  startedAt: 1000,
};

function renderHandlers(target: AgentInfo = agent) {
  const state = {
    agents: [target],
    selectAgent: vi.fn(),
    setFullscreenAgent: vi.fn(),
    resumeInterruptedAgent: vi.fn(async () => target),
    notificationsUnreadCount: 0,
    rootPath: null,
  };
  const { result } = renderHook(() =>
    useAgentAndCommandHandlers({ state } as unknown as UseAgentAndCommandHandlersProps)
  );
  return { state, handlers: result.current };
}

describe('selecting an agent while the terminals are detached', () => {
  beforeEach(() => {
    showAgentInWindow.mockReset().mockResolvedValue(true);
    useStore.setState({ agentWindowOpen: false });
  });
  afterEach(() => {
    useStore.setState({ agentWindowOpen: false });
  });

  it('opens the terminal modal when there is no agent window', () => {
    const { state, handlers } = renderHandlers();

    handlers.handleSelectAgent('a');

    expect(state.selectAgent).toHaveBeenCalledWith('a');
    expect(state.setFullscreenAgent).toHaveBeenCalledWith(agent);
    expect(showAgentInWindow).not.toHaveBeenCalled();
  });

  it('brings the agent window forward on that agent, and opens no modal', () => {
    useStore.setState({ agentWindowOpen: true });
    const { state, handlers } = renderHandlers();

    handlers.handleSelectAgent('a');

    // Still selected: that is what marks a finished agent as reviewed.
    expect(state.selectAgent).toHaveBeenCalledWith('a');
    expect(showAgentInWindow).toHaveBeenCalledWith('a');
    expect(state.setFullscreenAgent).not.toHaveBeenCalled();
  });

  it('a headless agent is selected but opens no terminal anywhere', () => {
    useStore.setState({ agentWindowOpen: true });
    const { state, handlers } = renderHandlers({ ...agent, headless: true });

    handlers.handleSelectAgent('a');

    expect(state.selectAgent).toHaveBeenCalledWith('a');
    expect(showAgentInWindow).not.toHaveBeenCalled();
    expect(state.setFullscreenAgent).not.toHaveBeenCalled();
  });

  it('clearing the selection reaches for neither', () => {
    useStore.setState({ agentWindowOpen: true });
    const { state, handlers } = renderHandlers();

    handlers.handleSelectAgent(null);

    expect(state.selectAgent).toHaveBeenCalledWith(null);
    expect(showAgentInWindow).not.toHaveBeenCalled();
    expect(state.setFullscreenAgent).not.toHaveBeenCalled();
  });

  it('a resumed agent shows in the agent window too', async () => {
    useStore.setState({ agentWindowOpen: true });
    const { state, handlers } = renderHandlers();

    await handlers.handleResumeInterrupted('a');

    expect(showAgentInWindow).toHaveBeenCalledWith('a');
    expect(state.setFullscreenAgent).not.toHaveBeenCalled();
  });

  it('falls back to the modal when the agent window turns out to be gone', async () => {
    useStore.setState({ agentWindowOpen: true });
    showAgentInWindow.mockResolvedValue(false);
    const { state, handlers } = renderHandlers();

    handlers.handleSelectAgent('a');

    await waitFor(() => expect(state.setFullscreenAgent).toHaveBeenCalledWith(agent));
  });

  it('falls back to the modal when reaching the window fails outright', async () => {
    useStore.setState({ agentWindowOpen: true });
    showAgentInWindow.mockRejectedValue(new Error('no such window'));
    const { state, handlers } = renderHandlers();

    handlers.handleSelectAgent('a');

    await waitFor(() => expect(state.setFullscreenAgent).toHaveBeenCalledWith(agent));
  });

  it('a resumed agent falls back to the modal the same way', async () => {
    useStore.setState({ agentWindowOpen: true });
    showAgentInWindow.mockResolvedValue(false);
    const { state, handlers } = renderHandlers();

    await handlers.handleResumeInterrupted('a');

    await waitFor(() => expect(state.setFullscreenAgent).toHaveBeenCalledWith(agent));
  });

  it('a resumed agent opens in the modal when there is no agent window', async () => {
    const { state, handlers } = renderHandlers();

    await handlers.handleResumeInterrupted('a');

    expect(state.setFullscreenAgent).toHaveBeenCalledWith(agent);
    expect(showAgentInWindow).not.toHaveBeenCalled();
  });
});

describe('resuming an interrupted agent that Rust refuses', () => {
  it('says why in a toast and opens nothing', async () => {
    const showToast = vi.fn(() => 0);
    useStore.setState({ showToast });
    const { state, handlers } = renderHandlers();
    // Tauri rejects with the plain sentence, as for any refused spawn.
    const reason =
      'The run folder 2026-10-21_090000 is already in use by the running supervisor agent-3.';
    state.resumeInterruptedAgent.mockRejectedValueOnce(reason);

    await handlers.handleResumeInterrupted('a');

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(`Could not resume the agent: ${reason}`, 'error')
    );
    expect(state.setFullscreenAgent).not.toHaveBeenCalled();
  });
});
