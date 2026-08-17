import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KbdHint } from './KbdHint';

describe('KbdHint', () => {
  it('renders the key chip and the label', () => {
    render(<KbdHint keys="⏎" label="Add" />);
    expect(screen.getByText('⏎')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
  });
});
