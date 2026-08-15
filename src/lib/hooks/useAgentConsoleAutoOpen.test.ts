import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAgentConsoleAutoOpen } from './useAgentConsoleAutoOpen';
import { useStore } from '@/lib/store';
import { setAppConfigValue } from '@/lib/config/appConfig';
import type { AgentInfo } from '@/lib/tauri/agents';

const runningAgent: AgentInfo = {
  id: 'a1',
  name: 'agent',
  status: 'running',
  model: 'm',
  provider: 'claude',
  startedAt: 0,
};

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ rootPath: null, agents: [], agentConsoleOpen: false });
});

describe('useAgentConsoleAutoOpen', () => {
  it('does nothing when the preference is off', () => {
    useStore.setState({ agents: [runningAgent] });

    renderHook(() => useAgentConsoleAutoOpen());

    expect(useStore.getState().agentConsoleOpen).toBe(false);
  });

  it('does nothing while a project is open, even with the preference on and agents running', () => {
    setAppConfigValue('agentConsoleAutoOpen', true);
    useStore.setState({ rootPath: '/w/alpha', agents: [runningAgent] });

    renderHook(() => useAgentConsoleAutoOpen());

    expect(useStore.getState().agentConsoleOpen).toBe(false);
  });

  it('does nothing without a running agent, even with the preference on', () => {
    setAppConfigValue('agentConsoleAutoOpen', true);
    useStore.setState({ rootPath: null, agents: [{ ...runningAgent, status: 'idle' }] });

    renderHook(() => useAgentConsoleAutoOpen());

    expect(useStore.getState().agentConsoleOpen).toBe(false);
  });

  it('opens the console once when no project is open, an agent is running, and the preference is on', () => {
    setAppConfigValue('agentConsoleAutoOpen', true);
    useStore.setState({ rootPath: null, agents: [runningAgent] });

    renderHook(() => useAgentConsoleAutoOpen());

    expect(useStore.getState().agentConsoleOpen).toBe(true);
  });

  it('does not reopen after the user closes it', () => {
    setAppConfigValue('agentConsoleAutoOpen', true);
    useStore.setState({ rootPath: null, agents: [runningAgent] });

    const { rerender } = renderHook(() => useAgentConsoleAutoOpen());
    expect(useStore.getState().agentConsoleOpen).toBe(true);

    useStore.getState().closeAgentConsole();
    useStore.setState({ agents: [runningAgent, { ...runningAgent, id: 'a2' }] });
    rerender();

    expect(useStore.getState().agentConsoleOpen).toBe(false);
  });
});
