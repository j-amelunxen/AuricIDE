import { describe, expect, it } from 'vitest';
import { validateRefName } from './graphNames';

const ok = (name: string, taken: string[] = []) => validateRefName(name, new Set(taken));

describe('validateRefName', () => {
  it.each(['main', 'feature/login', 'release-1.2', 'fix_42', 'v1.0.0', 'ünï'])(
    'accepts %s',
    (name) => {
      expect(ok(name)).toBeNull();
    }
  );

  it('asks for a name when empty or blank', () => {
    expect(ok('')).toBe('Enter a name.');
    expect(ok('   ')).toBe('Enter a name.');
  });

  it.each([
    ['has space', 'Names cannot contain spaces.'],
    ['a..b', 'Names cannot contain “..”.'],
    ['a~b', 'Names cannot contain ~ ^ : ? * [ or a backslash.'],
    ['a^b', 'Names cannot contain ~ ^ : ? * [ or a backslash.'],
    ['a:b', 'Names cannot contain ~ ^ : ? * [ or a backslash.'],
    ['a\\b', 'Names cannot contain ~ ^ : ? * [ or a backslash.'],
    ['a@{b', 'Names cannot contain “@{”.'],
    ['-dash', 'Names cannot start with a dash.'],
    ['/lead', 'Names cannot start or end with a slash.'],
    ['trail/', 'Names cannot start or end with a slash.'],
    ['a//b', 'Names cannot contain two slashes in a row.'],
    ['dot.', 'Names cannot end with a dot.'],
    ['x.lock', 'Names cannot end with “.lock”.'],
    ['a/.hidden', 'A part of the name cannot start with a dot.'],
    ['@', 'That name is reserved.'],
  ])('rejects %s', (name, message) => {
    expect(ok(name)).toBe(message);
  });

  it('rejects control characters', () => {
    expect(ok('a\u0007b')).toBe('Names cannot contain control characters.');
  });

  it('rejects a taken name', () => {
    expect(ok('main', ['main'])).toBe('That name is already taken.');
  });
});
