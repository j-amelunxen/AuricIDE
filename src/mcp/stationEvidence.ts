import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { globMatch } from '../lib/evidence/globMatch';
import type { EvidenceContext } from '../lib/evidence/predicates';
import type { StationPredicate } from '../lib/tauri/goals';

/**
 * Predicates the MCP server can decide from the project database and the
 * filesystem alone. `git_touches` is left to the IDE's evidence engine, which
 * already asks git through Rust; a second git path here could disagree with it.
 */
export function isServerCheckable(predicate: StationPredicate): boolean {
  return (
    predicate.type === 'file_exists' ||
    predicate.type === 'ticket_done' ||
    predicate.type === 'requirement_verified'
  );
}

/**
 * Folders the IDE's file list leaves out (`list_all_files_impl`,
 * src-tauri/src/commands/fs_commands.rs). A station must see exactly the files
 * the frontend engine sees, or a claim passes here and fails there.
 */
const PRUNED_DIRS = new Set(['.git', 'node_modules', 'target', '.auric']);

/** True as soon as one file under `root` matches `glob`. Paths are absolute,
 * like the IDE's list, and symlinks are not followed, like its walk. */
function projectFileExists(root: string, glob: string): boolean {
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable folder: the IDE's walk skips it too
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!PRUNED_DIRS.has(entry.name)) pending.push(path);
      } else if (entry.isFile() && globMatch(glob, path)) {
        return true;
      }
    }
  }
  return false;
}

function nowTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** The evidence context for server-side checks: SQL for tickets and
 * requirements, the project folder for files, no git and no judge. */
export function buildServerEvidenceContext(
  db: Database.Database,
  projectRoot: string
): EvidenceContext {
  return {
    projectPath: projectRoot,
    tickets: db
      .prepare('SELECT id, name, status FROM pm_tickets')
      .all() as EvidenceContext['tickets'],
    requirements: db
      .prepare('SELECT id, req_id AS reqId, status FROM pm_requirements')
      .all() as EvidenceContext['requirements'],
    testCases: [],
    fileExists: async (glob) => projectFileExists(projectRoot, glob),
    gitLogSince: async () => {
      throw new Error('git is not checked by the MCP server');
    },
    now: nowTimestamp,
  };
}
