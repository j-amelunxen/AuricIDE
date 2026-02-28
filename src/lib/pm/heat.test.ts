import { describe, it, expect } from 'vitest';
import { calculateHeat } from './heat';
import type { PmDependency } from '../tauri/pm';

describe('calculateHeat', () => {
  const mockDeps: PmDependency[] = [
    { id: '1', sourceType: 'ticket', sourceId: 'A', targetType: 'ticket', targetId: 'B' },
    { id: '2', sourceType: 'ticket', sourceId: 'C', targetType: 'ticket', targetId: 'B' },
    { id: '3', sourceType: 'ticket', sourceId: 'B', targetType: 'ticket', targetId: 'D' },
    { id: '4', sourceType: 'epic', sourceId: 'E1', targetType: 'ticket', targetId: 'D' },
  ];

  it('should return 0 for a ticket with no incoming dependencies', () => {
    expect(calculateHeat('A', mockDeps)).toBe(0);
    expect(calculateHeat('C', mockDeps)).toBe(0);
  });

  it('should count incoming ticket dependencies', () => {
    expect(calculateHeat('B', mockDeps)).toBe(2);
  });

  it('should count incoming dependencies from any source (epic or ticket)', () => {
    expect(calculateHeat('D', mockDeps)).toBe(2);
  });

  it('should return 0 for unknown ticket', () => {
    expect(calculateHeat('X', mockDeps)).toBe(0);
  });
});
