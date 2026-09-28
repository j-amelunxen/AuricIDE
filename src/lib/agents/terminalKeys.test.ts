import { describe, expect, it } from 'vitest';
import fixtures from './agentControl.fixtures.json';
import { TERMINAL_ENTER } from './terminalKeys';

describe('TERMINAL_ENTER', () => {
  it('is the Enter the control socket writes, so UI and socket submit alike', () => {
    expect(TERMINAL_ENTER).toBe(fixtures.enter);
  });
});
