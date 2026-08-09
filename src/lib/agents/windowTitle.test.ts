import { describe, it, expect } from 'vitest';
import { composeWindowTitle } from './windowTitle';

describe('composeWindowTitle', () => {
  it('is just the app name while nothing needs a human', () => {
    expect(composeWindowTitle(0)).toBe('AuricIDE');
  });

  it('carries the attention count like an unread badge', () => {
    // The window title is readable from the dock, the tab strip, and any
    // other app — checking on the fleet must not require switching to it.
    expect(composeWindowTitle(1)).toBe('(1) AuricIDE');
    expect(composeWindowTitle(3)).toBe('(3) AuricIDE');
  });
});
