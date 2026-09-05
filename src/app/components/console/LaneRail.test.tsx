import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Lane } from '@/lib/agents/lanes';
import { LaneRail } from './LaneRail';

function makeLane(overrides: Partial<Lane> = {}): Lane {
  return {
    agentId: 'a1',
    agentName: 'Waitlist',
    repoPath: '/repos/acme-app',
    projectLabel: 'acme-app',
    monogram: 'WA',
    color: '#56ccf2',
    state: 'working',
    phaseLabel: 'Running',
    rightNow: 'Editing src/a.ts',
    unread: 0,
    hasQuestion: false,
    muted: false,
    running: true,
    ...overrides,
  };
}

describe('LaneRail', () => {
  it('lists one row per lane plus an All lanes row', () => {
    render(
      <LaneRail
        lanes={[makeLane(), makeLane({ agentId: 'a2', agentName: 'Wiki lint' })]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /All lanes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Waitlist/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Wiki lint/ })).toBeInTheDocument();
  });

  it('shows the fleet total unread on the All lanes row', () => {
    render(
      <LaneRail
        lanes={[
          makeLane({ unread: 3 }),
          makeLane({ agentId: 'a2', agentName: 'Wiki lint', unread: 4 }),
        ]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /All lanes/ })).toHaveTextContent('7');
  });

  it('selects a lane on click and clicking it again clears the selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <LaneRail
        lanes={[makeLane()]}
        selectedAgentId={null}
        onSelect={onSelect}
        onToggleMute={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /^Waitlist/ }));
    expect(onSelect).toHaveBeenCalledWith('a1');

    onSelect.mockClear();
    render(
      <LaneRail
        lanes={[makeLane()]}
        selectedAgentId="a1"
        onSelect={onSelect}
        onToggleMute={vi.fn()}
      />
    );
    await user.click(screen.getAllByRole('button', { name: /^Waitlist/ })[1]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('clicking All lanes clears the selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <LaneRail
        lanes={[makeLane()]}
        selectedAgentId="a1"
        onSelect={onSelect}
        onToggleMute={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /All lanes/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('hides the unread badge at zero and shows 99+ past 99', () => {
    render(
      <LaneRail
        lanes={[
          makeLane({ unread: 0 }),
          makeLane({ agentId: 'a2', agentName: 'Wiki lint', unread: 140 }),
        ]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    const waitlistRow = screen.getByTestId('lane-row-a1');
    expect(within(waitlistRow).queryByTestId('lane-unread-badge')).not.toBeInTheDocument();

    const wikiRow = screen.getByTestId('lane-row-a2');
    expect(within(wikiRow).getByTestId('lane-unread-badge')).toHaveTextContent('99+');
  });

  it('shows a question badge only when the lane has a question', () => {
    render(
      <LaneRail
        lanes={[
          makeLane({ hasQuestion: true }),
          makeLane({ agentId: 'a2', agentName: 'Wiki lint', hasQuestion: false }),
        ]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    expect(within(screen.getByTestId('lane-row-a1')).getByText('Needs you')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('lane-row-a2')).queryByText('Needs you')
    ).not.toBeInTheDocument();
  });

  it('toggles mute via its own control without selecting the lane', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onToggleMute = vi.fn();
    render(
      <LaneRail
        lanes={[makeLane()]}
        selectedAgentId={null}
        onSelect={onSelect}
        onToggleMute={onToggleMute}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Mute Waitlist' }));
    expect(onToggleMute).toHaveBeenCalledWith('a1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('labels the mute control as Unmute once a lane is muted', () => {
    render(
      <LaneRail
        lanes={[makeLane({ muted: true })]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Unmute Waitlist' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('dims only the identity — monogram and name — of a muted lane, not the rest of the row', () => {
    render(
      <LaneRail
        lanes={[
          makeLane({
            muted: true,
            unread: 4,
            hasQuestion: true,
            rightNow: 'Waiting on: overwrite the config?',
          }),
        ]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    expect(screen.getByTestId('lane-monogram-a1').className).toMatch(/opacity/);
    expect(screen.getByTestId('lane-name-a1').className).toMatch(/opacity/);
    // A muted lane's question still has to surface (rule 14) — it and the
    // unread count, the project label and the summary read at full strength.
    expect(screen.getByTestId('lane-unread-badge').className).not.toMatch(/opacity-\d/);
    expect(screen.getByText('Needs you').closest('span')?.className).not.toMatch(/opacity-\d/);
    expect(screen.getByText('Waiting on: overwrite the config?').className).not.toMatch(
      /opacity-\d/
    );
  });

  it('never colours the "Muted" label amber — that hue is reserved for status', () => {
    render(
      <LaneRail
        lanes={[makeLane({ muted: true })]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    const muteButton = screen.getByRole('button', { name: 'Unmute Waitlist' });
    expect(muteButton.className).not.toMatch(/amber/);
    expect(muteButton.className).toMatch(/text-\[1[0-9]px\]/);
  });

  it('wraps the All-lanes row in a listitem like the other rows', () => {
    render(
      <LaneRail
        lanes={[makeLane()]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    const allLanesButton = screen.getByRole('button', { name: /All lanes/ });
    expect(allLanesButton.closest('[role="listitem"]')).not.toBeNull();
  });

  it('keeps the mute control hidden until hover unless the lane is already muted', () => {
    render(
      <LaneRail
        lanes={[
          makeLane({ agentId: 'a1', muted: false }),
          makeLane({ agentId: 'a2', muted: true }),
        ]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Mute Waitlist' }).className.split(' ')).toContain(
      'opacity-0'
    );
    expect(screen.getByRole('button', { name: 'Unmute Waitlist' }).className.split(' ')).toContain(
      'opacity-100'
    );
  });

  it('prefers the lane summary over the generic activity line when one exists', () => {
    render(
      <LaneRail
        lanes={[makeLane({ rightNow: 'Editing src/a.ts' })]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
        laneSummaries={{
          a1: { kind: 'done', text: 'Shipped the waitlist form.', at: 1, source: 'extract' },
        }}
      />
    );

    expect(screen.getByText('Shipped the waitlist form.')).toBeInTheDocument();
    expect(screen.queryByText('Editing src/a.ts')).not.toBeInTheDocument();
  });

  it('falls back to the generic activity line once an ask summary is stale', () => {
    render(
      <LaneRail
        lanes={[makeLane({ rightNow: 'Editing src/a.ts', hasQuestion: false })]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
        laneSummaries={{
          a1: { kind: 'ask', text: 'Overwrite the file?', at: 1, source: 'extract' },
        }}
      />
    );

    expect(screen.getByText('Editing src/a.ts')).toBeInTheDocument();
    expect(screen.queryByText('Overwrite the file?')).not.toBeInTheDocument();
  });

  it('moves focus between lane rows with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <LaneRail
        lanes={[makeLane(), makeLane({ agentId: 'a2', agentName: 'Wiki lint' })]}
        selectedAgentId={null}
        onSelect={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    screen.getByRole('button', { name: /All lanes/ }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /^Waitlist/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /^Wiki lint/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('button', { name: /^Waitlist/ })).toHaveFocus();
  });
});
