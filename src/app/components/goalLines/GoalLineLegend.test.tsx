import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GoalLineLegend } from './GoalLineLegend';

describe('GoalLineLegend', () => {
  it('shows each station mark as a short labeled swatch', () => {
    render(<GoalLineLegend />);
    const legend = screen.getByTestId('goal-line-legend');
    expect(legend.getAttribute('aria-label')).toBe('Checkpoint legend');
    for (const label of [
      'complete',
      'in progress',
      'upcoming',
      'later',
      'reported',
      'AI check',
      'needs review',
      'human',
      'agent',
    ]) {
      expect(legend.textContent).toContain(label);
    }
    // no equals-sign prose wall
    expect(legend.textContent).not.toMatch(/=/);
  });
});
