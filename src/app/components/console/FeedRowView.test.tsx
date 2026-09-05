import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FeedRow } from '@/lib/agents/events/feed';
import { FeedRowView } from './FeedRowView';

const at = new Date(2024, 0, 1, 14, 55, 0).getTime();

function makeRow(overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    agentId: 'a1',
    agentName: 'Waitlist',
    kind: 'edit',
    label: 'Edited src/a.ts',
    at,
    ...overrides,
  };
}

describe('FeedRowView', () => {
  it('renders a tool call as a small, muted, one-line system row', () => {
    render(<FeedRowView row={makeRow({ kind: 'edit', label: 'Edited src/a.ts' })} />);
    const row = screen.getByTestId('feed-row');
    expect(row).toHaveTextContent('Edited src/a.ts');
    const label = screen.getByText('Edited src/a.ts');
    expect(label.className).toContain('truncate');
    expect(label.className).toContain('font-mono');
  });

  it('renders a note as wrapping prose, not monospace', () => {
    render(<FeedRowView row={makeRow({ kind: 'note', label: 'I will start with the tests' })} />);
    const label = screen.getByText('I will start with the tests');
    expect(label.className).toContain('line-clamp-3');
    expect(label.className).not.toContain('font-mono');
  });

  it('gives a question its icon, sr-only label, amber colour and wraps instead of truncating', () => {
    const longAsk = 'Overwrite '.repeat(20).trim() + '?';
    render(<FeedRowView row={makeRow({ kind: 'ask', label: longAsk })} />);
    const row = screen.getByTestId('feed-row');
    expect(row.className).toMatch(/amber/);
    expect(screen.getByText('Question')).toBeInTheDocument();
    const label = within(row).getByText(longAsk);
    expect(label.className.split(' ')).not.toContain('truncate');
    expect(label.className).toContain('line-clamp-3');
  });

  it('marks a finish with a check icon and the primary colour, not red', () => {
    render(<FeedRowView row={makeRow({ kind: 'done', label: 'Finished · 3 files' })} />);
    const row = screen.getByTestId('feed-row');
    expect(screen.getByText('Finished')).toBeInTheDocument();
    expect(row.className).not.toMatch(/red/);
  });

  it('marks a failure with a red row and its own icon, distinct from a finish', () => {
    render(<FeedRowView row={makeRow({ kind: 'error', label: 'Crashed' })} />);
    const row = screen.getByTestId('feed-row');
    expect(row.className).toMatch(/red/);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('renders a sent message as the right-aligned bubble, with a sr-only "You"', () => {
    render(<FeedRowView row={makeRow({ kind: 'sent', label: 'Go ahead' })} />);
    expect(screen.getByTestId('feed-row')).toBeInTheDocument();
    expect(screen.getByText('You')).toHaveClass('sr-only');
    const bubble = screen.getByText('Go ahead');
    expect(bubble.className).toContain('ml-auto');
    expect(bubble.className).toContain('rounded-2xl');
  });

  it('renders a raw output line the same tier as a note — prose, not a tool call', () => {
    render(<FeedRowView row={makeRow({ kind: 'line', label: 'Now writing the tests' })} />);
    const label = screen.getByText('Now writing the tests');
    expect(label.className).toContain('line-clamp-3');
  });

  it('shows the row’s own clock time in the left column', () => {
    render(<FeedRowView row={makeRow()} />);
    expect(screen.getByText('14:55:00')).toBeInTheDocument();
  });
});
