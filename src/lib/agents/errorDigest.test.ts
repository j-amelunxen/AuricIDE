import { describe, it, expect } from 'vitest';
import { deriveErrorDigest, ERROR_DIGEST_MAX_CHARS } from './errorDigest';

describe('deriveErrorDigest', () => {
  it('finds the last error line in the tail', () => {
    const chunks = [
      'Compiling...\n',
      'error: cannot find module "fleet"\n',
      'Retrying...\n',
      'Error: ENOENT no such file or directory\n',
      'Shutting down.\n',
    ];
    expect(deriveErrorDigest(chunks)).toBe('Error: ENOENT no such file or directory');
  });

  it('recognises common failure phrasings', () => {
    expect(deriveErrorDigest(['Tests failed: 3 of 12\n'])).toContain('failed');
    expect(deriveErrorDigest(['thread panicked at src/lib.rs:42\n'])).toContain('panicked');
    expect(deriveErrorDigest(['Process exited with exit code 1\n'])).toContain('exit code 1');
    expect(deriveErrorDigest(['FATAL: database connection lost\n'])).toContain('FATAL');
  });

  it('falls back to the last meaningful line when nothing looks like an error', () => {
    // A process can die without printing the word "error" — the last thing it
    // said is still the best available clue.
    const chunks = ['Working on step 3\n', 'Killed\n'];
    expect(deriveErrorDigest(chunks)).toBe('Killed');
  });

  it('returns null for an empty or noise-only tail', () => {
    expect(deriveErrorDigest([])).toBeNull();
    expect(deriveErrorDigest(['\n\n', '───\n'])).toBeNull();
  });

  it('cleans ANSI codes and truncates long lines', () => {
    const long = `error: ${'x'.repeat(200)}`;
    const digest = deriveErrorDigest([`[31m${long}[0m\n`]);
    expect(digest).not.toContain('');
    expect(digest!.length).toBeLessThanOrEqual(ERROR_DIGEST_MAX_CHARS + 1); // +1 for the ellipsis
  });
});
