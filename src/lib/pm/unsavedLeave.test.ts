import { describe, expect, it } from 'vitest';
import { ticketCreateFormIsDirty } from './unsavedLeave';

describe('ticketCreateFormIsDirty', () => {
  const blank = {
    name: '',
    description: '',
    status: 'open',
    priority: 'normal',
    dependencyCount: 0,
  };

  it('is clean when the form is still at its defaults', () => {
    expect(ticketCreateFormIsDirty(blank)).toBe(false);
  });

  it('is dirty once a name is typed', () => {
    expect(ticketCreateFormIsDirty({ ...blank, name: 'Ship the inbox' })).toBe(true);
  });

  it('ignores surrounding whitespace on an otherwise empty name', () => {
    expect(ticketCreateFormIsDirty({ ...blank, name: '   ' })).toBe(false);
  });

  it('is dirty when a description, status, priority or dependency changes', () => {
    expect(ticketCreateFormIsDirty({ ...blank, description: 'later' })).toBe(true);
    expect(ticketCreateFormIsDirty({ ...blank, status: 'in_progress' })).toBe(true);
    expect(ticketCreateFormIsDirty({ ...blank, priority: 'high' })).toBe(true);
    expect(ticketCreateFormIsDirty({ ...blank, dependencyCount: 1 })).toBe(true);
    expect(ticketCreateFormIsDirty({ ...blank, skillCount: 1 })).toBe(true);
  });

  it('treats prefilled create (file/canvas) as clean until the user edits', () => {
    expect(
      ticketCreateFormIsDirty({
        ...blank,
        name: 'From file',
        description: 'snippet',
        initialName: 'From file',
        initialDescription: 'snippet',
      })
    ).toBe(false);
    expect(
      ticketCreateFormIsDirty({
        ...blank,
        name: 'From file, edited',
        description: 'snippet',
        initialName: 'From file',
        initialDescription: 'snippet',
      })
    ).toBe(true);
  });
});
