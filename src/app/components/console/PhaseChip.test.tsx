import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PhaseChip } from './PhaseChip';

describe('PhaseChip', () => {
  it('renders the visible phase label', () => {
    render(<PhaseChip state="working" label="Running" />);
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('Running');
  });
});
