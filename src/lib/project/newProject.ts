export type NewProjectTemplate = 'empty' | 'notes' | 'spec';

export interface NewProjectOptions {
  name: string;
  parentDir: string;
  template: NewProjectTemplate;
}

/** Removes characters that are unsafe in a folder name. */
export function sanitizeProjectName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, '').trim();
}

/** Path separator used by a given parent directory (Windows vs POSIX). */
export function pathSeparator(parentDir: string): string {
  return parentDir.includes('\\') && !parentDir.includes('/') ? '\\' : '/';
}

/** Joins a parent directory and a child name using the parent's path separator. */
export function joinProjectPath(parentDir: string, name: string): string {
  const sep = pathSeparator(parentDir);
  const trimmed = parentDir.replace(/[\\/]+$/, '');
  return `${trimmed}${sep}${name}`;
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

/**
 * Pure planner: given the target project directory, template and name, returns
 * the list of files (with content) that should be written to scaffold it.
 * Directory creation and IO are handled by the caller.
 */
export function scaffoldProjectFiles(
  projectDir: string,
  name: string,
  template: NewProjectTemplate
): ScaffoldFile[] {
  const sep = pathSeparator(projectDir);
  const at = (rel: string) => `${projectDir}${sep}${rel.split('/').join(sep)}`;

  const readme: ScaffoldFile = {
    path: at('README.md'),
    content: `# ${name}\n\nCreated with AuricIDE.\n`,
  };

  switch (template) {
    case 'notes':
      return [
        readme,
        {
          path: at('notes/welcome.md'),
          content: `# Welcome\n\nStart writing your notes here.\n`,
        },
      ];
    case 'spec':
      return [
        readme,
        {
          path: at('spec.md'),
          content: `# ${name}: Specification\n\n## Goal\n\n_Describe what this project should achieve._\n\n## Requirements\n\n- [ ] First requirement\n`,
        },
      ];
    case 'empty':
    default:
      return [readme];
  }
}

/** Directories that must exist before the scaffold files can be written. */
export function scaffoldDirectories(projectDir: string, template: NewProjectTemplate): string[] {
  const sep = pathSeparator(projectDir);
  const dirs = [projectDir];
  if (template === 'notes') dirs.push(`${projectDir}${sep}notes`);
  return dirs;
}
