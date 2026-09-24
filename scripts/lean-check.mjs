import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const CORPUS_RELATIVE_PATH = 'verification/contracts/provider-policy-v1.jsonl';
const LEAN_DIRECTORY_RELATIVE_PATH = 'verification/lean';
const LEAN_EXECUTABLE = 'provider-policy-oracle';
const MCP_LIFECYCLE_MODEL = 'AuricIDE.McpLifecycle';
const MCP_SESSION_ISOLATION_MODEL = 'AuricIDE.McpSessionIsolation';

export function assertIdenticalCorpus(expected, generated) {
  if (expected === generated) return;

  let offset = 0;
  while (offset < expected.length && expected[offset] === generated[offset]) offset += 1;
  throw new Error(
    `Lean oracle corpus differs byte-for-byte at offset ${offset}; regenerate ${CORPUS_RELATIVE_PATH} with the pinned toolchain.`
  );
}

export async function verifyLeanCorpus({
  repositoryRoot = process.cwd(),
  execute = execFile,
} = {}) {
  const root = resolve(repositoryRoot);
  const corpusPath = join(root, CORPUS_RELATIVE_PATH);
  const leanDirectory = join(root, LEAN_DIRECTORY_RELATIVE_PATH);
  const expected = await readFile(corpusPath, 'utf8');
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'auric-lean-provider-policy-'));
  const regeneratedPath = join(temporaryDirectory, 'provider-policy-v1.jsonl');

  try {
    let result;
    try {
      await execute('lake', ['build', MCP_LIFECYCLE_MODEL], {
        cwd: leanDirectory,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      await execute('lake', ['build', MCP_SESSION_ISOLATION_MODEL], {
        cwd: leanDirectory,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      result = await execute('lake', ['exe', LEAN_EXECUTABLE], {
        cwd: leanDirectory,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Lean oracle could not run: ${detail}\nInstall and verify with:\n` +
          'curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh\n' +
          `cd verification/lean && lake build ${MCP_LIFECYCLE_MODEL} ${MCP_SESSION_ISOLATION_MODEL} && lake exe provider-policy-oracle`
      );
    }

    await writeFile(regeneratedPath, result.stdout, 'utf8');
    const regenerated = await readFile(regeneratedPath, 'utf8');
    assertIdenticalCorpus(expected, regenerated);
    return { corpusPath };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const { corpusPath } = await verifyLeanCorpus();
  process.stdout.write(
    `Lean MCP lifecycle and session-isolation proofs compiled; provider-policy oracle matches ${corpusPath} byte-for-byte.\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`lean-check: ${error.message}\n`);
    process.exitCode = 1;
  });
}
