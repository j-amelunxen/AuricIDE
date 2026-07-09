import { describe, it, expect } from 'vitest';
import {
  sanitizeProjectName,
  joinProjectPath,
  scaffoldProjectFiles,
  scaffoldDirectories,
} from './newProject';

describe('sanitizeProjectName', () => {
  it('strips path separators and illegal characters', () => {
    expect(sanitizeProjectName('my/awesome:proj*')).toBe('myawesomeproj');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeProjectName('  cool app  ')).toBe('cool app');
  });
});

describe('joinProjectPath', () => {
  it('joins with a POSIX separator', () => {
    expect(joinProjectPath('/Users/j/dev', 'app')).toBe('/Users/j/dev/app');
  });

  it('does not duplicate a trailing separator', () => {
    expect(joinProjectPath('/Users/j/dev/', 'app')).toBe('/Users/j/dev/app');
  });

  it('uses a backslash separator on Windows paths', () => {
    expect(joinProjectPath('C:\\Users\\j', 'app')).toBe('C:\\Users\\j\\app');
  });
});

describe('scaffoldProjectFiles', () => {
  it('creates only a README for the empty template', () => {
    const files = scaffoldProjectFiles('/p/app', 'app', 'empty');
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('/p/app/README.md');
    expect(files[0].content).toContain('# app');
  });

  it('adds a notes folder file for the notes template', () => {
    const files = scaffoldProjectFiles('/p/app', 'app', 'notes');
    expect(files.map((f) => f.path)).toContain('/p/app/notes/welcome.md');
    expect(scaffoldDirectories('/p/app', 'notes')).toContain('/p/app/notes');
  });

  it('adds a spec.md for the spec template', () => {
    const files = scaffoldProjectFiles('/p/app', 'app', 'spec');
    const spec = files.find((f) => f.path === '/p/app/spec.md');
    expect(spec).toBeTruthy();
    expect(spec?.content).toContain('Specification');
  });
});
