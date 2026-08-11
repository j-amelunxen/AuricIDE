import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GoalLine, LineStation } from '@/lib/goals/goalLinesLayout';
import { GoalLineMap } from './GoalLineMap';

function station(index: number, count = 8): LineStation {
  return {
    id: `station-${index}`,
    label: `Station ${index} with a deliberately long label`,
    kind: index === count - 1 ? 'terminus' : 'normal',
    state: 'planned',
    evidence: 'claim',
    stale: false,
    ticketId: index === count - 1 ? undefined : `ticket-${index}`,
    x: count === 1 ? 0.5 : index / (count - 1),
    agentIds: [],
  };
}

function lineWithStations(count = 8): GoalLine {
  return {
    goalId: 'goal-1',
    name: 'Dense line',
    hue: '#7657ff',
    stations: Array.from({ length: count }, (_, index) => station(index, count)),
    lastDone: null,
    now: null,
    next: null,
    satisfied: false,
    blockers: [],
    planCommitted: false,
  };
}

describe('GoalLineMap station labels', () => {
  const renderedLabels = (count: number): SVGTextElement[] => {
    const { container } = render(
      <GoalLineMap line={lineWithStations(count)} agentsById={new Map()} />
    );
    return Array.from(container.querySelectorAll('text'));
  };

  it('keeps a one-station line center-anchored', () => {
    const [label] = renderedLabels(1);
    expect(label).toHaveAttribute('text-anchor', 'middle');
  });

  it('keeps five stations in one label lane and starts staggering at six', () => {
    const fiveLabels = renderedLabels(5);
    expect(new Set(fiveLabels.map((label) => label.getAttribute('y')))).toHaveProperty('size', 1);

    const sixLabels = renderedLabels(6);
    expect(new Set(sixLabels.map((label) => label.getAttribute('y')))).toHaveProperty('size', 2);
    expect(sixLabels[0]).not.toHaveAttribute('y', sixLabels[1].getAttribute('y'));
  });

  it('stagger labels on dense lines and anchors the edge labels inside the viewBox', () => {
    const labels = renderedLabels(8);
    expect(labels).toHaveLength(8);
    expect(labels[0]).toHaveAttribute('text-anchor', 'start');
    expect(labels.at(-1)).toHaveAttribute('text-anchor', 'end');
    expect(labels[0]).not.toHaveAttribute('y', labels[1].getAttribute('y'));
    expect(labels[1]).toHaveAttribute('y', labels[3].getAttribute('y'));
    for (const label of labels) {
      expect(Number(label.getAttribute('x'))).toBeGreaterThanOrEqual(0);
      expect(Number(label.getAttribute('x'))).toBeLessThanOrEqual(600);
      expect(Number(label.getAttribute('y'))).toBeGreaterThanOrEqual(0);
      expect(Number(label.getAttribute('y'))).toBeLessThanOrEqual(120);
    }
  });

  it('keeps the full station label in its title while displaying a compact label', () => {
    const line = lineWithStations();
    render(<GoalLineMap line={line} agentsById={new Map()} />);

    const group = screen.getByTestId('station-station-0');
    expect(group.querySelector('title')?.textContent).toBe(line.stations[0].label);
    expect(group.querySelector('text')?.textContent).toBe('Station 0 wit…');
  });
});
