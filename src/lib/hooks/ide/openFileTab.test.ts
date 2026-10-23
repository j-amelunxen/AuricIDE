import { describe, expect, it, vi } from 'vitest';
import { openFileTab } from './openFileTab';

describe('openFileTab', () => {
  it('leaves the work place, selects the file and opens a tab named after it', () => {
    const calls: string[] = [];
    const actions = {
      closeWorkPlace: vi.fn(() => void calls.push('close')),
      selectFile: vi.fn(() => void calls.push('select')),
      openTab: vi.fn(() => void calls.push('tab')),
    };
    openFileTab('/p/notes/a.md', actions);
    expect(calls).toEqual(['close', 'select', 'tab']);
    expect(actions.selectFile).toHaveBeenCalledWith('/p/notes/a.md');
    expect(actions.openTab).toHaveBeenCalledWith({
      id: '/p/notes/a.md',
      path: '/p/notes/a.md',
      name: 'a.md',
    });
  });
});
