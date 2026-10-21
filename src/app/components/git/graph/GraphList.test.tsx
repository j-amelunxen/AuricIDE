import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GraphList, type GraphListProps } from './GraphList';
import { refsByOid } from './graphRefs';
import { laidOut, linearCommits, makeCommit, makeRef, makeRefs, oidOf } from './testGraph';

const NOW = 1_760_000_000_000;

function setup(over: Partial<GraphListProps> = {}) {
  const commits = over.commits ?? linearCommits(1000);
  const props: GraphListProps = {
    commits,
    rows: over.rows ?? laidOut(commits),
    refsByOid: new Map(),
    selectedOid: null,
    matches: new Set(),
    searching: false,
    dimmedOids: null,
    headOid: commits[0]?.oid ?? null,
    busyOid: null,
    hasMore: false,
    nowMs: NOW,
    reveal: null,
    onSelect: vi.fn(),
    onLoadMore: vi.fn(),
    onToggleInspector: vi.fn(),
    onCopySha: vi.fn(),
    onEscape: vi.fn(),
    onCommitContextMenu: vi.fn(),
    onRefContextMenu: vi.fn(),
    ...over,
  };
  const view = render(<GraphList {...props} />);
  return { props, listbox: screen.getByRole('listbox'), ...view };
}

describe('GraphList windowing', () => {
  it('renders only the visible rows plus overscan out of a thousand commits', () => {
    setup();
    const count = screen.getAllByRole('option').length;
    expect(count).toBeGreaterThan(10);
    expect(count).toBeLessThan(80);
    expect(screen.getByText('Commit number 0')).toBeInTheDocument();
    expect(screen.queryByText('Commit number 900')).not.toBeInTheDocument();
  });

  it('keeps the full scroll height so the scrollbar is honest', () => {
    const { listbox } = setup();
    expect(listbox.firstElementChild).toHaveStyle({ height: `${1000 * 28}px` });
  });

  it('swaps the rendered window when the list scrolls', () => {
    const { listbox } = setup();
    fireEvent.scroll(listbox, { target: { scrollTop: 28 * 500 } });
    expect(screen.getByText('Commit number 500')).toBeInTheDocument();
    expect(screen.queryByText('Commit number 0')).not.toBeInTheDocument();
  });

  it('shows rows that arrive after the first render', () => {
    const { rerender, props } = setup({ commits: [], rows: [] });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    const commits = linearCommits(5);
    rerender(<GraphList {...props} commits={commits} rows={laidOut(commits)} />);
    expect(screen.getAllByRole('option')).toHaveLength(5);
  });
});

describe('GraphList paging', () => {
  it('asks for the next page when the end is near and more exist', () => {
    const { props } = setup({ commits: linearCommits(50), hasMore: true });
    expect(props.onLoadMore).toHaveBeenCalled();
  });

  it('does not ask when everything is loaded', () => {
    const { props } = setup({ commits: linearCommits(50), hasMore: false });
    expect(props.onLoadMore).not.toHaveBeenCalled();
  });

  it('does not ask while the end is far away', () => {
    const { props } = setup({ commits: linearCommits(1000), hasMore: true });
    expect(props.onLoadMore).not.toHaveBeenCalled();
  });
});

describe('GraphList semantics', () => {
  it('is one listbox of options that read summary, author, date and refs', () => {
    const commits = linearCommits(3);
    setup({
      commits,
      rows: laidOut(commits),
      refsByOid: refsByOid(makeRefs([makeRef('main', 'local', 'c0', true)])),
    });
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveAccessibleName('Commit number 0, Ada Lovelace, now, branch main, current');
  });

  it('points aria-activedescendant at the selected row', () => {
    const commits = linearCommits(5);
    const { listbox } = setup({ commits, rows: laidOut(commits), selectedOid: 'c2' });
    const selected = screen
      .getAllByRole('option')
      .find((o) => o.getAttribute('aria-selected') === 'true')!;
    expect(listbox).toHaveAttribute('aria-activedescendant', selected.id);
    expect(selected).toHaveAccessibleName(/Commit number 2/);
  });

  it('puts the absolute date in the title of the date cell', () => {
    setup({ commits: linearCommits(2) });
    const row = screen.getAllByRole('option')[0];
    expect(within(row).getByText('now')).toHaveAttribute('title', expect.stringMatching(/20\d\d/));
  });
});

describe('GraphList keyboard', () => {
  const key = (el: HTMLElement, k: string, init: Partial<KeyboardEventInit> = {}) =>
    fireEvent.keyDown(el, { key: k, ...init });

  it('ArrowDown selects the first row when nothing is selected', () => {
    const { listbox, props } = setup({ commits: linearCommits(10) });
    key(listbox, 'ArrowDown');
    expect(props.onSelect).toHaveBeenLastCalledWith('c0');
  });

  it('ArrowDown walks to the next row', () => {
    const { listbox, props } = setup({ commits: linearCommits(10), selectedOid: 'c3' });
    key(listbox, 'ArrowDown');
    expect(props.onSelect).toHaveBeenLastCalledWith('c4');
  });

  it('ArrowUp stops at the first row', () => {
    const { listbox, props } = setup({ commits: linearCommits(10), selectedOid: 'c0' });
    key(listbox, 'ArrowUp');
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('Home and End jump to the ends', () => {
    const { listbox, props } = setup({ commits: linearCommits(10), selectedOid: 'c4' });
    key(listbox, 'End');
    expect(props.onSelect).toHaveBeenLastCalledWith('c9');
    key(listbox, 'Home');
    expect(props.onSelect).toHaveBeenLastCalledWith('c0');
  });

  it('PageDown moves by about a screen', () => {
    const { listbox, props } = setup({ commits: linearCommits(200), selectedOid: 'c0' });
    key(listbox, 'PageDown');
    const target = Number((props.onSelect as ReturnType<typeof vi.fn>).mock.calls[0][0].slice(1));
    expect(target).toBeGreaterThan(5);
    expect(target).toBeLessThan(40);
  });

  it('ArrowLeft goes to the first parent and ArrowRight back to the child', () => {
    const commits = [makeCommit(0, ['c1']), makeCommit(1, ['c2']), makeCommit(2, [])];
    const { listbox, props } = setup({ commits, selectedOid: 'c1' });
    key(listbox, 'ArrowLeft');
    expect(props.onSelect).toHaveBeenLastCalledWith('c2');
    key(listbox, 'ArrowRight');
    expect(props.onSelect).toHaveBeenLastCalledWith('c0');
  });

  it('ArrowLeft on a root commit does nothing', () => {
    const commits = [makeCommit(0, [])];
    const { listbox, props } = setup({ commits, selectedOid: 'c0' });
    key(listbox, 'ArrowLeft');
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('Return toggles the inspector, Cmd+C copies the sha, Escape is reported', () => {
    const { listbox, props } = setup({ commits: linearCommits(3), selectedOid: 'c1' });
    key(listbox, 'Enter');
    expect(props.onToggleInspector).toHaveBeenCalled();
    key(listbox, 'c', { metaKey: true });
    expect(props.onCopySha).toHaveBeenCalledWith('c1');
    key(listbox, 'Escape');
    expect(props.onEscape).toHaveBeenCalled();
  });

  it('selects a row on click and offers its context menu at the pointer', () => {
    const { props } = setup({ commits: linearCommits(3) });
    const row = screen.getAllByRole('option')[1];
    fireEvent.click(row);
    expect(props.onSelect).toHaveBeenLastCalledWith('c1');
    fireEvent.contextMenu(row, { clientX: 40, clientY: 60 });
    expect(props.onCommitContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ oid: 'c1' }),
      { x: 40, y: 60 },
      false
    );
  });

  it('opens the commit menu from the keyboard, flagged as keyboard so refs are included', () => {
    const { listbox, props } = setup({ commits: linearCommits(3), selectedOid: 'c1' });
    key(listbox, 'ContextMenu');
    expect(props.onCommitContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ oid: 'c1' }),
      expect.objectContaining({ x: expect.any(Number) }),
      true
    );
    key(listbox, 'F10', { shiftKey: true });
    expect(props.onCommitContextMenu).toHaveBeenCalledTimes(2);
  });

  it('offers the ref menu from a pill without opening the commit menu', () => {
    const commits = linearCommits(2);
    const { props } = setup({
      commits,
      refsByOid: refsByOid(makeRefs([makeRef('feature', 'local', 'c0')])),
    });
    fireEvent.contextMenu(screen.getByText('feature'), { clientX: 5, clientY: 6 });
    expect(props.onRefContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ shorthand: 'feature' }),
      { x: 5, y: 6 }
    );
    expect(props.onCommitContextMenu).not.toHaveBeenCalled();
  });
});

describe('GraphList row state', () => {
  it('marks search matches and fades the rest while searching', () => {
    setup({ commits: linearCommits(3), matches: new Set(['c1']), searching: true });
    const [r0, r1] = screen.getAllByRole('option');
    expect(r1).toHaveAttribute('data-match', 'true');
    expect(r0).not.toHaveAttribute('data-match');
    expect(within(r0).getByText('Commit number 0')).toHaveClass('opacity-70');
    expect(within(r1).getByText('Commit number 1')).not.toHaveClass('opacity-70');
  });

  it('dims commits outside the branch filter', () => {
    setup({ commits: linearCommits(3), dimmedOids: new Set(['c2']) });
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('data-dimmed', 'true');
    expect(screen.getAllByRole('option')[0]).not.toHaveAttribute('data-dimmed');
  });

  it('dims only lanes and pills, and keeps the text readable', () => {
    setup({ commits: linearCommits(3), dimmedOids: new Set(['c2']) });
    const row = screen.getAllByRole('option')[2];
    expect(row.querySelector('svg')?.parentElement).toHaveClass('opacity-40');
    const text = within(row).getByText('Commit number 2');
    expect(text).toHaveClass('opacity-70');
    expect(text.className).not.toMatch(/opacity-(40|50|60)/);
    expect(row.className).not.toMatch(/(^| )opacity-/);
  });

  it('uses the full foreground for author and date on the selected row', () => {
    setup({ commits: linearCommits(2), selectedOid: 'c0' });
    expect(within(screen.getAllByRole('option')[0]).getByText('now')).toHaveClass(
      'text-foreground'
    );
    expect(within(screen.getAllByRole('option')[1]).getByText('1 h ago')).toHaveClass(
      'text-foreground-muted'
    );
  });

  it('keeps the selected row in the DOM when it is outside the window', () => {
    const { listbox } = setup({ selectedOid: 'c900' });
    fireEvent.scroll(listbox, { target: { scrollTop: 0 } });
    const selected = screen.getAllByRole('option').find((o) => o.id === 'graph-row-c900');
    expect(selected).toBeDefined();
    expect(listbox).toHaveAttribute('aria-activedescendant', 'graph-row-c900');
  });

  it('shows a focus ring on the list when it is reached by keyboard', () => {
    const { listbox } = setup({ commits: linearCommits(2) });
    expect(listbox.className).toContain('focus-visible:outline-2');
    expect(listbox.className).not.toContain('outline-none');
  });

  it('draws selection neutral until the list has focus, then in the accent', () => {
    setup({ commits: linearCommits(2), selectedOid: 'c0' });
    const cls = screen.getAllByRole('option')[0].className;
    expect(cls).toContain('bg-[color-mix(in_srgb,var(--foreground)_14%,var(--editor-bg))]');
    expect(cls).toContain('group-focus-within/list:bg-[color-mix(in_srgb,var(--primary)_28%');
  });

  it('shows a spinner on the row an operation is working on', () => {
    setup({ commits: linearCommits(3), busyOid: 'c1' });
    expect(within(screen.getAllByRole('option')[1]).getByRole('progressbar')).toBeInTheDocument();
    expect(within(screen.getAllByRole('option')[0]).queryByRole('progressbar')).toBeNull();
  });

  it('rings the HEAD row', () => {
    setup({ commits: linearCommits(3), headOid: oidOf(1) });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('data-head', 'true');
  });
});

describe('GraphList reveal', () => {
  it('scrolls a far-away row into view and pulses it', () => {
    const commits = linearCommits(1000);
    const { rerender, props, listbox } = setup({ commits });
    rerender(<GraphList {...props} reveal={{ oid: 'c700', pulse: true, nonce: 1 }} />);
    expect(listbox.scrollTop).toBeGreaterThan(28 * 600);
    expect(screen.getByText('Commit number 700').closest('[role="option"]')).toHaveAttribute(
      'data-pulse',
      'true'
    );
  });
});
