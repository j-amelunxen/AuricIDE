import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const step = (id, command, args = []) => Object.freeze({ id, command, args: Object.freeze(args) });

export const GATES = Object.freeze({
  fast: Object.freeze([
    step('inventory', 'node', ['scripts/test-inventory.mjs']),
    step('tooling-tests', 'node', ['--import', 'tsx', '--test', '@scripts-tests']),
    step('typecheck', 'pnpm', ['typecheck']),
    step('lint', 'pnpm', ['lint']),
    step('format', 'pnpm', ['format:check']),
    step('typescript-tests', 'pnpm', ['test:run']),
    step('rust-tests', 'pnpm', ['tauri:test']),
    step('lean', 'node', ['scripts/lean-check.mjs']),
  ]),
  pr: Object.freeze([
    step('fast-gate', 'node', ['scripts/verify.mjs', 'fast']),
    step('tauri-version-compatibility', 'pnpm', ['tauri:versions:check']),
    step('e2e-release-boundary', 'pnpm', ['tauri:e2e-release-boundary:check']),
    step('automation-surface', 'pnpm', ['automation-surface:check']),
    step('unused-code', 'pnpm', ['knip']),
    step('duplication', 'pnpm', ['jscpd']),
    step('rust-clippy', 'pnpm', ['tauri:clippy']),
    step('rust-format', 'pnpm', ['tauri:fmt:check']),
    step('rust-unused-deps', 'pnpm', ['tauri:machete']),
    step('browser-e2e', 'pnpm', ['test:e2e']),
  ]),
  native: Object.freeze([step('tauri-e2e', 'pnpm', ['test:e2e:tauri'])]),
  release: Object.freeze([
    step('pr-gate', 'node', ['scripts/verify.mjs', 'pr']),
    step('native-gate', 'node', ['scripts/verify.mjs', 'native']),
    step('production-build', 'pnpm', ['build:production', '--no-install']),
  ]),
});

async function materializeStep(definition) {
  if (!definition.args.includes('@scripts-tests')) return definition;

  const tests = (await readdir('scripts'))
    .filter((name) => /\.test\.m[jt]s$/.test(name))
    .sort()
    .map((name) => `scripts/${name}`);
  if (tests.length === 0) {
    throw new Error('No tooling tests found under scripts/*.test.{mjs,mts}');
  }

  return {
    ...definition,
    args: definition.args.flatMap((argument) => (argument === '@scripts-tests' ? tests : argument)),
  };
}

function printable(definition) {
  return [definition.command, ...definition.args].join(' ');
}

async function execute(definition, { dryRun = false } = {}) {
  const runnable = await materializeStep(definition);
  process.stdout.write(`\n[verify:${definition.id}] ${printable(runnable)}\n`);
  if (dryRun) return 0;

  return await new Promise((resolve, reject) => {
    const child = spawn(runnable.command, runnable.args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${definition.id} terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

export async function runGate(name, executeStep = execute, options = {}) {
  const steps = GATES[name];
  if (!steps) throw new Error(`Unknown verification gate: ${name}`);

  for (const definition of steps) {
    const exitCode = await executeStep(definition, options);
    if (exitCode !== 0) {
      throw new Error(`Verification step ${definition.id} failed with exit code ${exitCode}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const positional = args.filter((argument) => argument !== '--dry-run');
  if (positional.length !== 1) {
    throw new Error('Usage: node scripts/verify.mjs <fast|pr|native|release> [--dry-run]');
  }

  const [gate] = positional;
  await runGate(gate, execute, { dryRun });
  process.stdout.write(`\nVerification gate '${gate}' passed.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`verify: ${error.message}\n`);
    process.exitCode = 1;
  });
}
