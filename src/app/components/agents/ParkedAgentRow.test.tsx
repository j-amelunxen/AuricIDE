import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { ParkedAgentRow } from './ParkedAgentRow';

vi.mock('@/lib/hooks/useNow', () => ({ useNow: () => Date.now() }));

const agent: AgentInfo = {
  id: 'agent-1',
  name: 'Writer',
  model: 'claude-opus-4-6',
  provider: 'claude',
  status: 'running',
  currentTask: 'Writing documentation',
  startedAt: 1000,
};

describe('ParkedAgentRow', () => {
  it('names the agent and restores it on click', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(<ParkedAgentRow agent={agent} onRestore={onRestore} onKill={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Restore Writer' }));
    expect(onRestore).toHaveBeenCalledWith('agent-1');
  });

  it('keeps the task reachable as a tooltip without spending a line on it', () => {
    render(<ParkedAgentRow agent={agent} onRestore={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Restore Writer' })).toHaveAttribute(
      'title',
      'Writer — Writing documentation'
    );
  });

  it('can terminate a parked agent without restoring it first', async () => {
    const user = userEvent.setup();
    const onKill = vi.fn();
    render(<ParkedAgentRow agent={agent} onRestore={vi.fn()} onKill={onKill} />);

    await user.click(screen.getByRole('button', { name: 'Terminate Writer' }));
    expect(onKill).toHaveBeenCalledWith('agent-1');
  });

  it('still shows liveness while parked', () => {
    const { container } = render(
      <ParkedAgentRow
        agent={{ ...agent, lastActivityAt: Date.now() }}
        onRestore={vi.fn()}
        onKill={vi.fn()}
      />
    );
    expect(container.querySelector('.bg-primary')).toBeInTheDocument();
  });

  it('marks a failed agent apart from a working one', () => {
    const { container } = render(
      <ParkedAgentRow agent={{ ...agent, status: 'error' }} onRestore={vi.fn()} onKill={vi.fn()} />
    );
    expect(container.querySelector('.bg-red-400')).toBeInTheDocument();
  });

  it('hides the decorative dot from assistive technology', () => {
    const { container } = render(
      <ParkedAgentRow agent={agent} onRestore={vi.fn()} onKill={vi.fn()} />
    );
    container
      .querySelectorAll('span[aria-hidden="true"]')
      .forEach((el) => expect(el).toHaveAttribute('aria-hidden', 'true'));
    expect(container.querySelectorAll('span[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});
