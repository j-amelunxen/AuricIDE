import { describe, expect, it } from 'vitest';
import { normalizeMissionPath, resolveMissionDir } from './missionPath';

describe('normalizeMissionPath', () => {
  it('keeps a plain project-relative folder', () => {
    expect(normalizeMissionPath('missions/sample')).toBe('missions/sample');
  });

  it('reads blank and absent as "no mission"', () => {
    expect(normalizeMissionPath(undefined)).toBeNull();
    expect(normalizeMissionPath(null)).toBeNull();
    expect(normalizeMissionPath('')).toBeNull();
    expect(normalizeMissionPath('   ')).toBeNull();
  });

  it('tidies the spellings people type for the same folder', () => {
    expect(normalizeMissionPath('  ./missions//sample/ ')).toBe('missions/sample');
    expect(normalizeMissionPath('missions/./sample')).toBe('missions/sample');
    expect(normalizeMissionPath('missions\\sample')).toBe('missions/sample');
  });

  it('refuses an absolute path, because the project may move', () => {
    expect(() => normalizeMissionPath('/Users/dev/project/missions/sample')).toThrow(
      /relative to the project/i
    );
    expect(() => normalizeMissionPath('~/missions/sample')).toThrow(/relative to the project/i);
    expect(() => normalizeMissionPath('C:\\work\\missions')).toThrow(/relative to the project/i);
    expect(() => normalizeMissionPath('\\\\server\\share\\missions')).toThrow(
      /relative to the project/i
    );
  });

  it('refuses a path that climbs out of the project', () => {
    expect(() => normalizeMissionPath('../other/missions/sample')).toThrow(/inside the project/i);
    expect(() => normalizeMissionPath('missions/../../elsewhere')).toThrow(/inside the project/i);
    expect(() => normalizeMissionPath('..\\outside')).toThrow(/inside the project/i);
  });

  it('refuses a path that points at the project root itself', () => {
    expect(() => normalizeMissionPath('.')).toThrow(/folder inside the project/i);
  });
});

describe('resolveMissionDir', () => {
  it('joins the project root and the stored relative path', () => {
    expect(resolveMissionDir('/work/project', 'missions/sample')).toBe(
      '/work/project/missions/sample'
    );
    expect(resolveMissionDir('/work/project/', 'missions/sample')).toBe(
      '/work/project/missions/sample'
    );
  });

  it('answers null when there is no root or no mission to resolve', () => {
    expect(resolveMissionDir(null, 'missions/sample')).toBeNull();
    expect(resolveMissionDir('/work/project', null)).toBeNull();
    expect(resolveMissionDir('/work/project', undefined)).toBeNull();
  });

  it('answers null for a stored value that breaks the rule instead of escaping the project', () => {
    expect(resolveMissionDir('/work/project', '../elsewhere')).toBeNull();
    expect(resolveMissionDir('/work/project', '/etc')).toBeNull();
  });
});
