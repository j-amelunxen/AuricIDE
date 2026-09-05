import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeedToggle } from './FeedToggle';

const OPTIONS = [
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
] as const;

describe('FeedToggle', () => {
  it('marks the active option pressed and the rest not', () => {
    render(<FeedToggle options={OPTIONS} value="a" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the clicked option’s key', () => {
    const onChange = vi.fn();
    render(<FeedToggle options={OPTIONS} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('appends the caller’s className to its own', () => {
    render(<FeedToggle options={OPTIONS} value="a" onChange={vi.fn()} className="ml-auto" />);
    const group = screen.getByRole('button', { name: 'A' }).parentElement;
    expect(group?.className.split(' ')).toContain('ml-auto');
  });
});
