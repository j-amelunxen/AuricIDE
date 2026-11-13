export interface HeadingRenameChange {
  filePath: string;
  from: number;
  to: number;
  oldText: string;
  newText: string;
}

/**
 * Apply rename changes to a single file's content.
 * Changes are applied in reverse offset order to preserve positions.
 */
export function applyChangesToContent(content: string, changes: HeadingRenameChange[]): string {
  if (changes.length === 0) return content;

  // Sort by `from` descending so we can apply from end to start
  const sorted = [...changes].sort((a, b) => b.from - a.from);

  let result = content;
  for (const change of sorted) {
    result = result.slice(0, change.from) + change.newText + result.slice(change.to);
  }

  return result;
}

/** A file a workspace edit could not read or write, with the reason. */
export interface WorkspaceEditFailure {
  path: string;
  reason: string;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads every file a workspace edit may touch. A file that cannot be read is
 * reported, not dropped: its references stay unchanged and the caller says so.
 */
export async function readWorkspaceFiles(
  paths: readonly string[],
  readFile: (path: string) => Promise<string>
): Promise<{ contents: Map<string, string>; failed: WorkspaceEditFailure[] }> {
  const contents = new Map<string, string>();
  const failed: WorkspaceEditFailure[] = [];
  for (const path of paths) {
    try {
      contents.set(path, await readFile(path));
    } catch (error) {
      failed.push({ path, reason: reasonOf(error) });
    }
  }
  return { contents, failed };
}

/**
 * Applies `changes` file by file to `contents` and writes each result. Every
 * file is attempted; one that fails to write is reported and the others are
 * still written, so the outcome names exactly what changed on disk.
 */
export async function writeWorkspaceChanges(
  changes: readonly HeadingRenameChange[],
  contents: ReadonlyMap<string, string>,
  writeFile: (path: string, content: string) => Promise<void>
): Promise<{ written: Map<string, string>; failed: WorkspaceEditFailure[] }> {
  const byFile = new Map<string, HeadingRenameChange[]>();
  for (const change of changes) {
    const list = byFile.get(change.filePath) ?? [];
    list.push(change);
    byFile.set(change.filePath, list);
  }
  const written = new Map<string, string>();
  const failed: WorkspaceEditFailure[] = [];
  for (const [path, fileChanges] of byFile) {
    const updated = applyChangesToContent(contents.get(path) ?? '', fileChanges);
    try {
      await writeFile(path, updated);
      written.set(path, updated);
    } catch (error) {
      failed.push({ path, reason: reasonOf(error) });
    }
  }
  return { written, failed };
}

/** One sentence naming the files a workspace edit left unchanged, or null. */
export function describeWorkspaceFailures(
  what: string,
  failed: readonly WorkspaceEditFailure[]
): string | null {
  if (failed.length === 0) return null;
  const names = failed.map((f) => f.path.split('/').pop() ?? f.path);
  const listed =
    names.length > 3
      ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
      : names.join(', ');
  return `${what}: ${failed.length === 1 ? 'one file was' : `${failed.length} files were`} left unchanged (${listed}).`;
}
