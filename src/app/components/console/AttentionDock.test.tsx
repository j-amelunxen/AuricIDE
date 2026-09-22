import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AttentionDock } from './AttentionDock';
import type { AttentionPop } from '@/lib/agents/attentionDock';

const pops: AttentionPop[] = [
  {
    agentId: 'a1',
    agentName: 'Waitlist',
    repoPath: '/repos/acme-app',
    reason: 'needs-input',
    headline: 'Permission requested: Bash(pnpm test)',
  },
  {
    agentId: 'a2',
    agentName: 'Broken',
    reason: 'error',
    headline: 'Crashed on migrate',
  },
];

describe('AttentionDock', () => {
  it('shows All clear when nothing needs a human', () => {
    render(<AttentionDock pops={[]} />);
    expect(screen.getByTestId('attention-dock')).toHaveTextContent('All clear');
    expect(screen.queryByTestId('attention-pop')).not.toBeInTheDocument();
  });

  it('pops each agent that needs a human, most urgent first', () => {
    render(<AttentionDock pops={pops} />);
    const cards = screen.getAllByTestId('attention-pop');
    expect(cards[0]).toHaveTextContent('Waitlist');
    expect(cards[0]).toHaveTextContent('Permission requested: Bash(pnpm test)');
    expect(cards[1]).toHaveTextContent('Broken');
    expect(cards[1]).toHaveTextContent('Crashed on migrate');
  });

  it('focuses the agent when a pop is clicked', async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    render(<AttentionDock pops={pops} onFocus={onFocus} />);

    await user.click(screen.getByRole('button', { name: /waitlist/i }));
    expect(onFocus).toHaveBeenCalledWith('a1');
  });
});
