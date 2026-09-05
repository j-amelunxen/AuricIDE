import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Monogram } from './Monogram';

describe('Monogram', () => {
  it('shows the two-letter monogram', () => {
    render(<Monogram monogram="WL" color="#ff0000" />);
    expect(screen.getByText('WL')).toBeInTheDocument();
  });

  it('is decorative — the name text next to it already says who this is', () => {
    render(<Monogram monogram="WL" color="#ff0000" />);
    expect(screen.getByText('WL')).toHaveAttribute('aria-hidden', 'true');
  });

  it('tints the badge with the agent’s identity colour', () => {
    render(<Monogram monogram="WL" color="#ff0000" />);
    const badge = screen.getByText('WL');
    expect(badge.style.color).toBe('rgb(255, 0, 0)');
    // A 20% tint of the identity colour as the background — not the same
    // opaque colour as the text, or the two letters would vanish into it.
    expect(badge.style.backgroundColor).not.toBe('');
    expect(badge.style.backgroundColor).not.toBe('rgb(255, 0, 0)');
  });

  it('carries the feed-agent-mark testid used to find "who is speaking" in the feed', () => {
    render(<Monogram monogram="WL" color="#ff0000" />);
    expect(screen.getByTestId('feed-agent-mark')).toBeInTheDocument();
  });
});
