import { describe, expect, it } from 'vitest';
import { needsDismissConfirm } from './dismissGate';

describe('needsDismissConfirm', () => {
  it('does not confirm a bare unsorted item', () => {
    expect(needsDismissConfirm({ notes: '', projectPath: null })).toBe(false);
  });

  it('confirms an item that carries notes', () => {
    expect(needsDismissConfirm({ notes: 'Remember the context', projectPath: null })).toBe(true);
  });

  it('confirms an item that is already assigned', () => {
    expect(needsDismissConfirm({ notes: '', projectPath: '/repos/alpha' })).toBe(true);
  });

  it('treats whitespace-only notes as no notes', () => {
    expect(needsDismissConfirm({ notes: '   ', projectPath: null })).toBe(false);
  });
});
