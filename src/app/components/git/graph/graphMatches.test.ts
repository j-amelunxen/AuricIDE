import { describe, expect, it } from 'vitest';
import { steppedMatchIndex } from './graphMatches';

// Row positions of three matches.
const positions = [2, 5, 9];

describe('steppedMatchIndex', () => {
  it('goes to the first match after the selected row', () => {
    expect(steppedMatchIndex(positions, 3, 1)).toBe(1);
  });
  it('starts at the first match when nothing is selected', () => {
    expect(steppedMatchIndex(positions, -1, 1)).toBe(0);
  });
  it('wraps from the last match to the first', () => {
    expect(steppedMatchIndex(positions, 9, 1)).toBe(0);
  });
  it('goes back to the nearest match above the selection', () => {
    expect(steppedMatchIndex(positions, 6, -1)).toBe(1);
    expect(steppedMatchIndex(positions, 5, -1)).toBe(0);
  });
  it('wraps from the first match to the last', () => {
    expect(steppedMatchIndex(positions, 2, -1)).toBe(2);
  });
  it('has nowhere to go without matches', () => {
    expect(steppedMatchIndex([], 3, 1)).toBeNull();
  });
});
