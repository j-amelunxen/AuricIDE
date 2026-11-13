import { describe, expect, it } from 'vitest';
import { statusName } from './labels';

describe('statusName', () => {
  it('names ticket and goal statuses the way the pickers do', () => {
    expect(statusName('in_progress')).toBe('In progress');
    expect(statusName('to_test')).toBe('To test');
    expect(statusName('achieved')).toBe('Achieved');
  });

  it('spells out a status neither list knows', () => {
    expect(statusName('waiting_on_vendor')).toBe('Waiting on vendor');
  });
});
