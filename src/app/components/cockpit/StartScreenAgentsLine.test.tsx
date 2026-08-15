import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { StartScreenAgentsLine } from './StartScreenAgentsLine';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';

const DAILY_TIP = { icon: 'lightbulb', text: 'Use Cmd+K to open the command palette.' };

function makeAgent(overrides: Partial<AgentInfo>): AgentInfo {
  return {
    id: overrides.id ?? 'a1',
    name: overrides.name ?? 'agent',
    status: 'running',
    model: 'model',
    provider: 'provider',
    startedAt: Date.now(),
    ...overrides,
  };
}

describe('StartScreenAgentsLine', () => {
  beforeEach(() => {
    useStore.setState({ agents: [], reviewedAgentIds: [], agentConsoleOpen: false });
  });

  it('renders the tip of the day when no agents are running', () => {
    render(<StartScreenAgentsLine dailyTip={DAILY_TIP} />);

    expect(screen.getByTestId('tip-of-the-day')).toBeInTheDocument();
    expect(screen.queryByTestId('start-screen-agents-line')).not.toBeInTheDocument();
  });

  it('shows a running-agents line across the right number of projects instead of the tip', () => {
    useStore.setState({
      agents: [
        makeAgent({ id: 'a1', repoPath: '/w/alpha' }),
        makeAgent({ id: 'a2', repoPath: '/w/alpha' }),
        makeAgent({ id: 'a3', repoPath: '/w/bravo' }),
      ],
    });

    render(<StartScreenAgentsLine dailyTip={DAILY_TIP} />);

    expect(screen.queryByTestId('tip-of-the-day')).not.toBeInTheDocument();
    const line = screen.getByTestId('start-screen-agents-line');
    expect(line).toHaveTextContent('3 agents running across 2 projects');
    expect(screen.getByRole('button', { name: 'Open Agent Console' })).toBeInTheDocument();
  });

  it('uses singular phrasing for one agent in one project', () => {
    useStore.setState({ agents: [makeAgent({ id: 'a1', repoPath: '/w/alpha' })] });

    render(<StartScreenAgentsLine dailyTip={DAILY_TIP} />);

    expect(screen.getByTestId('start-screen-agents-line')).toHaveTextContent(
      '1 agent running in 1 project'
    );
  });

  it('opens the Agent Console on click', () => {
    useStore.setState({ agents: [makeAgent({ id: 'a1', repoPath: '/w/alpha' })] });

    render(<StartScreenAgentsLine dailyTip={DAILY_TIP} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Agent Console' }));

    expect(useStore.getState().agentConsoleOpen).toBe(true);
  });

  it('appends how many agents need attention', () => {
    useStore.setState({
      agents: [
        makeAgent({ id: 'a1', repoPath: '/w/alpha', status: 'running', awaitingInput: true }),
        makeAgent({ id: 'a2', repoPath: '/w/alpha', status: 'running' }),
      ],
    });

    render(<StartScreenAgentsLine dailyTip={DAILY_TIP} />);

    expect(screen.getByTestId('start-screen-agents-line')).toHaveTextContent('1 needs you');
  });

  it('pluralizes the attention count for more than one agent', () => {
    useStore.setState({
      agents: [
        makeAgent({ id: 'a1', repoPath: '/w/alpha', status: 'running', awaitingInput: true }),
        makeAgent({ id: 'a2', repoPath: '/w/alpha', status: 'running', awaitingInput: true }),
      ],
    });

    render(<StartScreenAgentsLine dailyTip={DAILY_TIP} />);

    expect(screen.getByTestId('start-screen-agents-line')).toHaveTextContent('2 need you');
  });

  it('says nothing about attention when nothing needs it', () => {
    useStore.setState({ agents: [makeAgent({ id: 'a1', repoPath: '/w/alpha' })] });

    render(<StartScreenAgentsLine dailyTip={DAILY_TIP} />);

    expect(screen.getByTestId('start-screen-agents-line')).not.toHaveTextContent('need you');
  });
});
