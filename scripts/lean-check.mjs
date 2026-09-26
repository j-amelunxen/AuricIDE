import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const LEAN_DIRECTORY_RELATIVE_PATH = 'verification/lean';
/** Proof-only models: compiled, so every theorem is checked. */
const PROOF_MODELS = ['AuricIDE.McpLifecycle', 'AuricIDE.McpSessionIsolation'];
/**
 * Models with an executable oracle: building the executable compiles the
 * model and its proofs; its output must match the checked-in corpus the
 * TypeScript and Rust differential tests read.
 */
const ORACLES = [
  {
    executable: 'provider-policy-oracle',
    corpus: 'verification/contracts/provider-policy-v1.jsonl',
  },
  { executable: 'launch-gate-oracle', corpus: 'verification/contracts/launch-gate-v1.jsonl' },
];
const EXEC_OPTIONS = { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 };
/** Lean's standard axioms; anything else (e.g. `sorryAx`) fails the check. */
const STANDARD_AXIOMS = new Set(['propext', 'Classical.choice', 'Quot.sound']);
/**
 * Theorems whose axioms are printed and checked: the requirement theorems of
 * the launch gate (goal-native mission, REQ-LAUNCH-01..03).
 */
export const AXIOM_CHECKS = [
  {
    module: 'AuricIDE.LaunchGate',
    namespace: 'AuricIDE.LaunchGate',
    theorems: [
      'claim_start_iff_gate',
      'start_needs_grant_in_force',
      'revoked_no_start',
      'revocation_holds',
      'replacement_holds',
      'moved_goal_outside_root',
      'waiting_request_starts_after_grant',
      'waiting_request_example',
      'start_below_limit',
      'limit_holds_for_every_interleaving',
      'limit_after_grant',
      'slots_only_freed_by_resolution',
      'start_within_budget',
      'used_monotone',
      'spent_budget_no_start',
      'budget_spent_for_every_interleaving',
      'budget_stops_root',
    ],
  },
];

/**
 * Reads `#print axioms` output and throws unless every listed theorem was
 * printed and depends on standard axioms only. Returns theorem -> axioms.
 */
export function assertStandardAxioms(output, check) {
  const found = {};
  for (const line of output.split('\n')) {
    const match = /^'([^']+)' (?:depends on axioms: \[(.*)\]|does not depend on any axioms)/.exec(
      line.trim()
    );
    if (!match) continue;
    const name = match[1].replace(`${check.namespace}.`, '');
    found[name] = match[2] ? match[2].split(',').map((axiom) => axiom.trim()) : [];
  }
  for (const theorem of check.theorems) {
    const axioms = found[theorem];
    if (!axioms) {
      throw new Error(`Lean axiom check: ${check.module}.${theorem} was not printed.\n${output}`);
    }
    const foreign = axioms.filter((axiom) => !STANDARD_AXIOMS.has(axiom));
    if (foreign.length > 0) {
      throw new Error(
        `Lean axiom check: ${check.module}.${theorem} depends on ${foreign.join(', ')}.`
      );
    }
  }
  return found;
}

export function assertIdenticalCorpus(expected, generated, corpus = ORACLES[0].corpus) {
  if (expected === generated) return;

  let offset = 0;
  while (offset < expected.length && expected[offset] === generated[offset]) offset += 1;
  throw new Error(
    `Lean oracle corpus differs byte-for-byte at offset ${offset}; regenerate ${corpus} with the pinned toolchain.`
  );
}

export async function verifyLeanCorpus({
  repositoryRoot = process.cwd(),
  execute = execFile,
} = {}) {
  const root = resolve(repositoryRoot);
  const leanDirectory = join(root, LEAN_DIRECTORY_RELATIVE_PATH);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'auric-lean-oracles-'));

  try {
    const outputs = [];
    try {
      for (const model of PROOF_MODELS) {
        await execute('lake', ['build', model], { cwd: leanDirectory, ...EXEC_OPTIONS });
      }
      for (const oracle of ORACLES) {
        const result = await execute('lake', ['exe', oracle.executable], {
          cwd: leanDirectory,
          ...EXEC_OPTIONS,
        });
        outputs.push({ oracle, stdout: result.stdout });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Lean oracle could not run: ${detail}\nInstall and verify with:\n` +
          'curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh\n' +
          `cd verification/lean && lake build ${PROOF_MODELS.join(' ')} && ` +
          ORACLES.map((oracle) => `lake exe ${oracle.executable}`).join(' && ')
      );
    }

    const axioms = {};
    for (const check of AXIOM_CHECKS) {
      const probe = join(temporaryDirectory, `${check.module.replaceAll('.', '_')}_axioms.lean`);
      await writeFile(
        probe,
        `import ${check.module}\n` +
          check.theorems.map((t) => `#print axioms ${check.namespace}.${t}\n`).join(''),
        'utf8'
      );
      let output;
      try {
        const result = await execute('lake', ['env', 'lean', probe], {
          cwd: leanDirectory,
          ...EXEC_OPTIONS,
        });
        output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Lean axiom check could not run for ${check.module}: ${detail}`);
      }
      axioms[check.module] = assertStandardAxioms(output, check);
    }

    const corpusPaths = [];
    for (const { oracle, stdout } of outputs) {
      const corpusPath = join(root, oracle.corpus);
      const expected = await readFile(corpusPath, 'utf8');
      const regeneratedPath = join(temporaryDirectory, `${oracle.executable}.jsonl`);
      await writeFile(regeneratedPath, stdout, 'utf8');
      const regenerated = await readFile(regeneratedPath, 'utf8');
      assertIdenticalCorpus(expected, regenerated, oracle.corpus);
      corpusPaths.push(corpusPath);
    }
    return { corpusPaths, axioms };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const { corpusPaths, axioms } = await verifyLeanCorpus();
  const checked = Object.values(axioms).reduce((sum, found) => sum + Object.keys(found).length, 0);
  process.stdout.write(
    `Lean MCP lifecycle, session-isolation and launch-gate proofs compiled; ${checked} requirement theorems use standard axioms only; oracles match ${corpusPaths.join(', ')} byte-for-byte.\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`lean-check: ${error.message}\n`);
    process.exitCode = 1;
  });
}
