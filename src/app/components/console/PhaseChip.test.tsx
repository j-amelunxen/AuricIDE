import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PhaseChip } from './PhaseChip';

describe('PhaseChip', () => {
  it('renders the given label', () => {
    render(<PhaseChip state="working" label="Running" />);
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('Running');
  });

  it('colours the amber "yours" state distinctly from the emerald "working" one', () => {
    const { rerender } = render(<PhaseChip state="working" label="Running" />);
    const workingClass = screen.getByTestId('phase-chip').className;

    rerender(<PhaseChip state="yours" label="Waiting on you" />);
    const yoursClass = screen.getByTestId('phase-chip').className;

    expect(yoursClass).not.toBe(workingClass);
    expect(yoursClass).toContain('amber');
  });

  it('shrinks its text under the compact size, for tight spots like the lane rail', () => {
    const { rerender } = render(<PhaseChip state="working" label="Running" />);
    const defaultClass = screen.getByTestId('phase-chip').className;
    expect(defaultClass).toContain('text-[10px]');

    rerender(<PhaseChip state="working" label="Running" size="compact" />);
    expect(screen.getByTestId('phase-chip').className).toContain('text-[9px]');
  });
});
