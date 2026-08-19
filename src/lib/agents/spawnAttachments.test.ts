import { describe, expect, it } from 'vitest';
import {
  composeTaskWithAttachments,
  mergeAttachmentPaths,
  spawnAttachmentLabel,
} from './spawnAttachments';

describe('composeTaskWithAttachments', () => {
  it('returns the trimmed instruction when nothing is attached', () => {
    expect(composeTaskWithAttachments('  Fix the login  ', [])).toBe('Fix the login');
  });

  it('appends each path on its own line so spaces in names stay one path', () => {
    expect(composeTaskWithAttachments('Look at this', ['/tmp/a.png', '/tmp/my shot.png'])).toBe(
      'Look at this\n\n/tmp/a.png\n/tmp/my shot.png'
    );
  });

  it('sends only the paths when the instruction is empty', () => {
    expect(composeTaskWithAttachments('   ', ['/tmp/a.png'])).toBe('/tmp/a.png');
  });
});

describe('mergeAttachmentPaths', () => {
  it('appends new paths and skips duplicates and blanks', () => {
    expect(mergeAttachmentPaths(['/a.png'], ['/a.png', '/b.png', '', '/b.png'])).toEqual([
      '/a.png',
      '/b.png',
    ]);
  });
});

describe('spawnAttachmentLabel', () => {
  it('shows the file name, including from Windows paths', () => {
    expect(spawnAttachmentLabel('/tmp/cache/shot.png')).toBe('shot.png');
    expect(spawnAttachmentLabel('C:\\Users\\jen\\shot.png')).toBe('shot.png');
  });
});
