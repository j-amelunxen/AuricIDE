import { describe, expect, it, vi } from 'vitest';
import { createStatusSignatureSelector } from './statusSignature';

describe('createStatusSignatureSelector', () => {
  const statuses = [
    { path: 'a.md', status: 'modified' },
    { path: 'b.md', status: 'added' },
    { path: 'a.md', status: 'added' },
  ];

  it('joins every status recorded for the path', () => {
    const select = createStatusSignatureSelector();
    expect(select(statuses, 'a.md')).toBe('modified,added');
    expect(select(statuses, 'c.md')).toBe('');
  });

  it('does not rescan the list while list and path are unchanged', () => {
    const select = createStatusSignatureSelector();
    const filter = vi.spyOn(statuses, 'filter');

    select(statuses, 'b.md');
    select(statuses, 'b.md');
    expect(filter).toHaveBeenCalledTimes(1);

    select(statuses, 'a.md');
    expect(filter).toHaveBeenCalledTimes(2);
    filter.mockRestore();
  });
});
