import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OriginCommit } from '@/lib/tauri/gitMerge';
import { SideOrigin } from './SideOrigin';

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const DAY = 86400;

function commit(n: number, summary: string, daysAgo: number): OriginCommit {
  return {
    oid: String(n).repeat(40),
    shortOid: String(n).repeat(7),
    summary,
    author: 'Dev',
    time: NOW / 1000 - daysAgo * DAY,
  };
}

describe('SideOrigin', () => {
  it('names the newest commit in one line, with its short oid and age', () => {
    render(<SideOrigin commits={[commit(1, 'Raise pool size', 3)]} now={NOW} />);
    const line = screen.getByTestId('side-origin');
    expect(line).toHaveTextContent('Raise pool size · 1111111 · 3 days ago');
  });

  it('tells a screen reader in words, not in separators', () => {
    render(<SideOrigin commits={[commit(1, 'Raise pool size', 3)]} now={NOW} />);
    expect(screen.getByText('Changed in commit Raise pool size, 3 days ago')).toBeInTheDocument();
  });

  it('counts further commits and lists up to three in the tooltip', () => {
    const commits = [
      commit(1, 'Newest', 1),
      commit(2, 'Middle', 2),
      commit(3, 'Older', 3),
      commit(4, 'Oldest', 4),
    ];
    render(<SideOrigin commits={commits} now={NOW} />);
    const line = screen.getByTestId('side-origin');
    expect(line).toHaveTextContent(/Newest · 1111111 · 1 day ago\s*\+3/);
    expect(line).toHaveAttribute(
      'title',
      'Newest (1111111, 1 day ago)\nMiddle (2222222, 2 days ago)\nOlder (3333333, 3 days ago)\nand 1 more'
    );
    expect(
      screen.getByText('Changed in commit Newest, 1 day ago, and 3 earlier commits')
    ).toBeInTheDocument();
  });

  it('says nothing for a side unchanged since the base, or before origins load', () => {
    const { container, rerender } = render(<SideOrigin commits={[]} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SideOrigin commits={undefined} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});
