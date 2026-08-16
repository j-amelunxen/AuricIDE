import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { heartbeatSeries, type HeartbeatBucket } from '@/lib/agents/events/heartbeat';
import { CONSOLE_STATE_HEARTBEAT_TONE, Heartbeat } from './Heartbeat';

const NOW = 100 * 60_000;

const series = (buckets: HeartbeatBucket[]) => heartbeatSeries(buckets, NOW);

const heights = (testId: string) =>
  screen.queryAllByTestId(testId).map((r) => Number(r.getAttribute('height')));

describe('Heartbeat', () => {
  it('draws one bar per band that had activity', () => {
    render(
      <Heartbeat
        samples={series([{ minute: 100, counts: { edit: 2, run: 1 } }])}
        scaleMax={4}
        tone="running"
      />
    );

    expect(screen.getAllByTestId('heartbeat-bar-edit')).toHaveLength(1);
    expect(screen.getAllByTestId('heartbeat-bar-run')).toHaveLength(1);
    expect(screen.queryAllByTestId('heartbeat-bar-ask')).toHaveLength(0);
  });

  it('draws nothing for a fleet that has been quiet the whole window', () => {
    render(<Heartbeat samples={series([])} scaleMax={1} tone="running" />);
    expect(screen.queryAllByTestId('heartbeat-bar-edit')).toHaveLength(0);
  });

  it('scales bars against the number it is given, not its own peak', () => {
    // This is the whole fix: two cards handed the same scaleMax draw
    // comparable heights. The old chart normalised each card to itself, so
    // one event and a hundred looked identical.
    const quiet = render(
      <Heartbeat
        samples={series([{ minute: 100, counts: { edit: 1 } }])}
        scaleMax={10}
        tone="running"
      />
    );
    const [quietHeight] = heights('heartbeat-bar-edit');
    quiet.unmount();

    render(
      <Heartbeat
        samples={series([{ minute: 100, counts: { edit: 10 } }])}
        scaleMax={10}
        tone="running"
      />
    );
    const [busyHeight] = heights('heartbeat-bar-edit');

    expect(busyHeight).toBeGreaterThan(quietHeight);
    expect(busyHeight / quietHeight).toBeCloseTo(10, 1);
  });

  it('gives each kind of work its own colour while the agent is running', () => {
    render(
      <Heartbeat
        samples={series([{ minute: 100, counts: { edit: 1, run: 1, ask: 1, read: 1 } }])}
        scaleMax={4}
        tone="running"
      />
    );

    const fills = ['edit', 'run', 'ask', 'read'].map((band) =>
      screen.getAllByTestId(`heartbeat-bar-${band}`)[0].getAttribute('fill')
    );
    expect(new Set(fills).size).toBe(4);
  });

  it('drops the whole chart to one tone once the agent stopped', () => {
    // Waiting, failed or done: at that point *that* it stopped matters far
    // more than what it had been doing, so the bands stop competing.
    render(
      <Heartbeat
        samples={series([{ minute: 100, counts: { edit: 1, run: 1 } }])}
        scaleMax={2}
        tone="failed"
      />
    );

    const fills = ['edit', 'run'].map((band) =>
      screen.getAllByTestId(`heartbeat-bar-${band}`)[0].getAttribute('fill')
    );
    expect(new Set(fills).size).toBe(1);
  });

  it('shows the number of events in the last minute beside the chart', () => {
    // The old chart showed a shape and no number at all, so there was no way
    // to tell one event from a hundred.
    render(
      <Heartbeat
        samples={series([{ minute: 100, counts: { edit: 3, ask: 1 } }])}
        scaleMax={4}
        tone="running"
      />
    );
    expect(screen.getByTestId('heartbeat-latest')).toHaveTextContent('4');
  });

  it('reads as a dash rather than a zero when the last minute was quiet', () => {
    render(<Heartbeat samples={series([])} scaleMax={1} tone="running" />);
    expect(screen.getByTestId('heartbeat-latest')).toHaveTextContent('—');
  });

  it('describes a minute in plain language for the tooltip', () => {
    render(
      <Heartbeat
        samples={series([{ minute: 100, counts: { edit: 3, ask: 1 } }])}
        scaleMax={4}
        tone="running"
      />
    );
    expect(screen.getByText('3 edits, 1 question')).toBeInTheDocument();
  });

  it('says so when a minute held nothing', () => {
    render(<Heartbeat samples={series([])} scaleMax={1} tone="running" />);
    expect(screen.getAllByText('nothing').length).toBeGreaterThan(0);
  });

  it('carries an accessible summary rather than being an unlabelled graphic', () => {
    render(
      <Heartbeat
        samples={series([{ minute: 100, counts: { edit: 2 } }])}
        scaleMax={2}
        tone="running"
      />
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Activity over the last 24 minutes, 2 in the last minute'
    );
  });

  it('never divides by zero when handed a scale of nothing', () => {
    expect(() =>
      render(
        <Heartbeat
          samples={series([{ minute: 100, counts: { edit: 1 } }])}
          scaleMax={0}
          tone="running"
        />
      )
    ).not.toThrow();
  });
});

describe('CONSOLE_STATE_HEARTBEAT_TONE', () => {
  it('maps every console state to a tone', () => {
    expect(CONSOLE_STATE_HEARTBEAT_TONE).toEqual({
      yours: 'waiting',
      error: 'failed',
      stalled: 'stalled',
      working: 'running',
      done: 'done',
    });
  });
});
