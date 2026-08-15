import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Heartbeat } from './Heartbeat';

describe('Heartbeat', () => {
  it('renders one point per sample', () => {
    const values = Array.from({ length: 24 }, (_, i) => i);
    const { getByTestId } = render(<Heartbeat values={values} tone="running" />);

    const polyline = getByTestId('heartbeat-line');
    const points = polyline.getAttribute('points')?.trim().split(/\s+/) ?? [];
    expect(points).toHaveLength(24);
  });

  it('renders flat at zero without dividing by zero', () => {
    const { getByTestId } = render(<Heartbeat values={new Array(24).fill(0)} tone="done" />);

    const polyline = getByTestId('heartbeat-line');
    expect(polyline.getAttribute('points')).toBeTruthy();
  });

  it('colours the line by tone', () => {
    const { getByTestId, rerender } = render(
      <Heartbeat values={new Array(24).fill(1)} tone="failed" />
    );
    const failedStroke = getByTestId('heartbeat-line').getAttribute('stroke');

    rerender(<Heartbeat values={new Array(24).fill(1)} tone="running" />);
    const runningStroke = getByTestId('heartbeat-line').getAttribute('stroke');

    expect(failedStroke).not.toBe(runningStroke);
  });
});
