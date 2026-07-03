import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentFleetPanel } from './AgentFleetPanel';
import type { AgentInfo } from '@/lib/tauri/agents';

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'a1',
    name: 'Agent (repo)',
    status: 'running',
    model: 'sonnet',
    provider: 'claude',
    currentTask: 'Fix the bug',
    startedAt: 0,
    repoPath: '/home/user/repo-one',
    ...overrides,
  };
}

describe('AgentFleetPanel', () => {
  it('shows an empty state with a deploy button', () => {
    const onNewAgent = vi.fn();
    render(
      <AgentFleetPanel
        agents={[]}
        onOpenAgent={() => {}}
        onKillAgent={() => {}}
        onNewAgent={onNewAgent}
      />
    );
    fireEvent.click(screen.getByText('Deploy your first agent'));
    expect(onNewAgent).toHaveBeenCalled();
  });

  it('groups agents by repo', () => {
    const agents = [
      makeAgent({ id: 'a1', repoPath: '/x/repo-one' }),
      makeAgent({ id: 'a2', repoPath: '/x/repo-two' }),
      makeAgent({ id: 'a3', repoPath: '/x/repo-two', status: 'idle' }),
    ];
    render(
      <AgentFleetPanel
        agents={agents}
        onOpenAgent={() => {}}
        onKillAgent={() => {}}
        onNewAgent={() => {}}
      />
    );
    expect(screen.getByText('repo-one')).toBeTruthy();
    expect(screen.getByText('repo-two')).toBeTruthy();
    expect(screen.getByTestId('fleet-agent-a3').textContent).toContain('finished');
  });

  it('opens an agent on click and kills via the kill button', () => {
    const onOpenAgent = vi.fn();
    const onKillAgent = vi.fn();
    render(
      <AgentFleetPanel
        agents={[makeAgent()]}
        onOpenAgent={onOpenAgent}
        onKillAgent={onKillAgent}
        onNewAgent={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Agent (repo)'));
    expect(onOpenAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    fireEvent.click(screen.getByTestId('fleet-kill-a1'));
    expect(onKillAgent).toHaveBeenCalledWith('a1');
  });

  it('launches a new agent from the header in one click', () => {
    const onNewAgent = vi.fn();
    render(
      <AgentFleetPanel
        agents={[makeAgent()]}
        onOpenAgent={() => {}}
        onKillAgent={() => {}}
        onNewAgent={onNewAgent}
      />
    );
    fireEvent.click(screen.getByTestId('fleet-new-agent-btn'));
    expect(onNewAgent).toHaveBeenCalled();
  });
});
