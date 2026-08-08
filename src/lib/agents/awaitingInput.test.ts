import { describe, it, expect } from 'vitest';
import { detectAwaitingInput } from './awaitingInput';

describe('detectAwaitingInput', () => {
  it('sees a y/n question', () => {
    expect(detectAwaitingInput(['Compiling...\n', 'Overwrite existing file? (y/n) '])).toBe(true);
    expect(detectAwaitingInput(['Proceed? [Y/n] '])).toBe(true);
    expect(detectAwaitingInput(['Continue? (yes/no): '])).toBe(true);
  });

  it('sees a CLI permission menu', () => {
    const menu = [
      'Do you want to make this edit to fleet.ts?\n',
      '❯ 1. Yes\n',
      '  2. Yes, allow all edits during this session\n',
      '  3. No, and tell Claude what to do differently\n',
    ];
    expect(detectAwaitingInput(menu)).toBe(true);
  });

  it('sees a press-enter prompt', () => {
    expect(detectAwaitingInput(['Press Enter to continue'])).toBe(true);
  });

  it('sees an explicit waiting-for-input line', () => {
    expect(detectAwaitingInput(['Waiting for your input...'])).toBe(true);
  });

  it('stays calm about ordinary streaming output', () => {
    expect(
      detectAwaitingInput(['Reading src/lib/agents/fleet.ts\n', 'Editing fleet.test.ts\n'])
    ).toBe(false);
  });

  it('does not treat a rhetorical question in prose as a prompt', () => {
    // Agents narrate ("what does this function do?") all the time — a bare
    // question mark is not a request for input.
    expect(
      detectAwaitingInput(['Hmm, what does splitFleet actually return?\n', 'Reading...'])
    ).toBe(false);
  });

  it('forgets a prompt once the conversation moved past it', () => {
    const moved = [
      'Overwrite existing file? (y/n) y\n',
      'Overwritten.\n',
      'Running tests\n',
      'All 12 passed\n',
      'Writing summary\n',
      'Linting\n',
      'Formatting\n',
      'Done.\n',
    ];
    expect(detectAwaitingInput(moved)).toBe(false);
  });

  it('returns false for an empty tail', () => {
    expect(detectAwaitingInput([])).toBe(false);
  });
});
