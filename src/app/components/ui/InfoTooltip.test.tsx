import { render, screen, fireEvent } from '@testing-library/react';
import { InfoTooltip } from './InfoTooltip';
import { describe, it, expect } from 'vitest';

describe('InfoTooltip', () => {
  it('renders with custom label', () => {
    render(<InfoTooltip description="Test description" label="E" />);
    expect(screen.getByText('E')).toBeInTheDocument();
  });

  it('shows description on mouse enter and hides on mouse leave', () => {
    render(<InfoTooltip description="Test description" label="E" />);

    const button = screen.getByRole('button');

    // Initially hidden
    expect(screen.queryByText('Test description')).not.toBeInTheDocument();

    // Hover
    fireEvent.mouseEnter(button);
    expect(screen.getByText('Test description')).toBeInTheDocument();

    // Leave
    fireEvent.mouseLeave(button);
    expect(screen.queryByText('Test description')).not.toBeInTheDocument();
  });
});
