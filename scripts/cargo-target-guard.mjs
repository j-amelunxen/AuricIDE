/**
 * Clears `src-tauri/target/debug` once it grows past a limit, before a cargo
 * command starts building into it.
 *
 * Cargo never removes an artifact it no longer uses. Every change of command
 * (`test`, `clippy`, `tauri dev`), feature set or dependency builds another
 * copy of the affected crates next to the old ones, and with several agents
 * alternating between them the folder reached 46 GB in a few days, one crate
 * lying there 53 times. A fresh debug build is about 5 GB, so the limit leaves
 * plenty of room for honest variants and only catches the pile-up.
 *
 * It never clears under a running build: another agent's cargo holds
 * `.cargo-lock`, and a running dev binary lives in the folder. Then it says so
 * and leaves the folder for the next run. It never fails the command it runs
 * in front of; a guard that broke builds would be worse than a full disk.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const GB = 1024 ** 3;
export const DEFAULT_LIMIT_GB = 25;
const SRC_TAURI = resolve(import.meta.dirname, '..', 'src-tauri');
const DEBUG_DIR = join(SRC_TAURI, 'target', 'debug');

/** @returns {'keep' | 'clean' | 'busy'} */
export function decideClean({ sizeBytes, limitBytes, busy }) {
  if (sizeBytes <= limitBytes) return 'keep';
  return busy ? 'busy' : 'clean';
}

export function limitBytesFrom(env) {
  const gb = Number(env.AURIC_CARGO_TARGET_LIMIT_GB);
  return (Number.isFinite(gb) && gb > 0 ? gb : DEFAULT_LIMIT_GB) * GB;
}

/** `du` counts hard links once; cargo links every artifact into two places. */
async function folderBytes(path) {
  const { stdout } = await execFile('du', ['-sk', path]);
  return Number.parseInt(stdout, 10) * 1024;
}

/** Both tools exit 1 when they find nothing, which is the answer "not busy". */
async function finds(command, args) {
  try {
    const { stdout } = await execFile(command, args);
    return stdout.trim() !== '';
  } catch {
    return false;
  }
}

async function buildIsRunning() {
  const lock = join(DEBUG_DIR, '.cargo-lock');
  if (existsSync(lock) && (await finds('lsof', ['-t', lock]))) return true;
  // rustc carries `--out-dir <target>/debug/deps`; the dev app runs from the folder.
  return finds('pgrep', ['-f', DEBUG_DIR]);
}

async function main() {
  if (!existsSync(DEBUG_DIR)) return;
  const sizeBytes = await folderBytes(DEBUG_DIR);
  const limitBytes = limitBytesFrom(process.env);
  if (decideClean({ sizeBytes, limitBytes, busy: false }) === 'keep') return;

  const size = `${(sizeBytes / GB).toFixed(1)} GB`;
  const limit = `${(limitBytes / GB).toFixed(0)} GB`;
  if (decideClean({ sizeBytes, limitBytes, busy: await buildIsRunning() }) === 'busy') {
    process.stdout.write(
      `cargo-target-guard: target/debug is ${size} (limit ${limit}), but a build is using it; left for the next run.\n`
    );
    return;
  }
  process.stdout.write(
    `cargo-target-guard: target/debug is ${size} (limit ${limit}); clearing it, this build starts from scratch.\n`
  );
  await execFile('cargo', ['clean', '--profile', 'dev'], { cwd: SRC_TAURI });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`cargo-target-guard: skipped, ${error.message}\n`);
  });
}
