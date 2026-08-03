import { describe, expect, it } from 'vitest';
import { newItemParentDir } from './newItemTarget';

const tree = [
  { path: '/p/README.md', isDirectory: false },
  {
    path: '/p/docs',
    isDirectory: true,
    children: [
      { path: '/p/docs/notes.md', isDirectory: false },
      { path: '/p/docs/assets', isDirectory: true, children: [] },
    ],
  },
];

describe('newItemParentDir', () => {
  it('falls back to the project root with nothing selected', () => {
    expect(newItemParentDir('/p', null, tree)).toBe('/p');
  });

  it('uses the selected folder itself', () => {
    expect(newItemParentDir('/p', '/p/docs', tree)).toBe('/p/docs');
  });

  it('uses a nested selected folder', () => {
    expect(newItemParentDir('/p', '/p/docs/assets', tree)).toBe('/p/docs/assets');
  });

  it('uses the folder of the selected file', () => {
    expect(newItemParentDir('/p', '/p/docs/notes.md', tree)).toBe('/p/docs');
  });

  it('stays at the root for a file sitting at the root', () => {
    expect(newItemParentDir('/p', '/p/README.md', tree)).toBe('/p');
  });

  it('treats an unknown path as a file and uses its folder', () => {
    expect(newItemParentDir('/p', '/p/docs/fresh.md', tree)).toBe('/p/docs');
  });

  it('ignores a selection outside the project', () => {
    expect(newItemParentDir('/p', '/other/notes.md', tree)).toBe('/p');
  });

  it('ignores a selection that merely shares the root prefix', () => {
    expect(newItemParentDir('/p', '/project/notes.md', tree)).toBe('/p');
  });

  it('tolerates a trailing slash on the root path', () => {
    expect(newItemParentDir('/p/', '/p/docs/notes.md', tree)).toBe('/p/docs');
  });
});
