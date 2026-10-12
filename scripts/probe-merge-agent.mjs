#!/usr/bin/env node
// Runs the merge panel's two agent paths against a real model through the
// installed `claude` CLI, in a throwaway repo made with the real git CLI, and
// checks the outcome the way the panel would: with the app's own prompt
// builders, parser, composer and syntax check (imported from src/ via tsx),
// and with git itself.
//
//   pnpm probe:merge-agent [--only a,b] [--model <id>] [--keep] [--budget <usd>]
//   (that is `node --import tsx scripts/probe-merge-agent.mjs`; tsx loads the .ts sources)
//
//   a  per-conflict proposals: buildProposalPrompt → claude -p → parseProposal
//      → composeResult → checkSyntax. No tools; the model only answers.
//   b  resolve all: buildResolveAllPrompt → claude -p inside the temp repo with
//      file tools and `git add`/`git rm`/`git show` only. Then git must show no
//      conflict left, no marker, everything staged, MERGE_HEAD still there and
//      HEAD unchanged (the agent did not commit).
//
// Costs real model turns (cents with the default Haiku). The CLI runs with
// --restricted, so user hooks, settings and MCP servers stay out of it, and
// its file tools are confined to the temp repo. Exit code 0 only when every
// assertion holds; 2 when the CLI is missing or not logged in.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? '');
};
const only = flag('--only')
  ?.split(',')
  .map((s) => s.trim().toLowerCase());
const model = flag('--model') ?? 'haiku';
const budget = flag('--budget') ?? '1';
const keep = args.includes('--keep');

const { buildProposalPrompt, parseProposal } =
  await import('../src/lib/git/merge/agentProposal.ts');
const { buildResolveAllPrompt } = await import('../src/lib/git/merge/resolveAllPrompt.ts');
const { composeResult, hasConflictMarkers, parseMergedText, resolutionLines } =
  await import('../src/lib/git/merge/conflictModel.ts');
const { intentFor } = await import('../src/lib/git/merge/conflictOrigins.ts');
const { checkSyntax } = await import('../src/lib/git/merge/syntaxCheck.ts');

const OURS = 'main';
const THEIRS = 'feature/annual-pricing';

// ---------------------------------------------------------------- the repo

const BASE_FILES = {
  'src/pricing.ts': [
    'export interface Plan {',
    '  name: string;',
    '  monthly: number;',
    '}',
    '',
    'export const PLANS: Plan[] = [',
    "  { name: 'basic', monthly: 10 },",
    "  { name: 'team', monthly: 30 },",
    '];',
    '',
    'export function yearlyPrice(plan: Plan): number {',
    '  return plan.monthly * 12;',
    '}',
    '',
  ],
  'config/limits.json': [
    '{',
    '  "maxProjects": 5,',
    '  "maxSeats": 3,',
    '  "trialDays": 14',
    '}',
    '',
  ],
};

/** Each side's commits: subject and the edits it makes, as [from, to] line pairs per file. */
const SIDE_COMMITS = {
  [OURS]: [
    {
      subject: 'Add a pro plan',
      edits: {
        'src/pricing.ts': [
          [
            "  { name: 'team', monthly: 30 },",
            "  { name: 'team', monthly: 30 },\n  { name: 'pro', monthly: 50 },",
          ],
        ],
      },
    },
    {
      subject: 'Give yearly plans two months free',
      edits: { 'src/pricing.ts': [['  return plan.monthly * 12;', '  return plan.monthly * 10;']] },
    },
    {
      subject: 'Raise the seat limit to five',
      edits: { 'config/limits.json': [['  "maxSeats": 3,', '  "maxSeats": 5,']] },
    },
  ],
  [THEIRS]: [
    {
      subject: 'Add an enterprise plan',
      edits: {
        'src/pricing.ts': [
          [
            "  { name: 'team', monthly: 30 },",
            "  { name: 'team', monthly: 30 },\n  { name: 'enterprise', monthly: 90 },",
          ],
        ],
      },
    },
    {
      subject: 'Round yearly prices to whole units',
      edits: {
        'src/pricing.ts': [
          ['  return plan.monthly * 12;', '  return Math.round(plan.monthly * 12);'],
        ],
      },
    },
    {
      subject: 'Allow a fourth seat and a 30-day trial',
      edits: {
        'config/limits.json': [
          ['  "maxSeats": 3,', '  "maxSeats": 4,'],
          ['  "trialDays": 14', '  "trialDays": 30'],
        ],
      },
    },
  ],
};

function git(cwd, ...a) {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '').trimEnd(), err: (r.stderr ?? '').trim() };
}

function writeFile(dir, path, text) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

function commitSide(dir, side) {
  for (const commit of SIDE_COMMITS[side]) {
    for (const [path, edits] of Object.entries(commit.edits)) {
      let text = readFileSync(join(dir, path), 'utf8');
      for (const [from, to] of edits) {
        if (!text.includes(from)) throw new Error(`probe setup: ${path} lacks ${from}`);
        text = text.replace(from, to);
      }
      writeFile(dir, path, text);
    }
    git(dir, 'commit', '-qam', commit.subject);
  }
}

/** A repo stopped in a merge with both files conflicted, diff3 markers in the tree. */
function makeConflictedRepo(label) {
  const dir = mkdtempSync(join(tmpdir(), `merge-agent-probe-${label}-`));
  git(dir, 'init', '-q', '-b', OURS);
  git(dir, 'config', 'user.email', 'probe@example.invalid');
  git(dir, 'config', 'user.name', 'probe');
  git(dir, 'config', 'merge.conflictStyle', 'diff3');
  for (const [path, lines] of Object.entries(BASE_FILES)) writeFile(dir, path, lines.join('\n'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Initial pricing and limits');
  git(dir, 'branch', THEIRS);
  commitSide(dir, OURS);
  git(dir, 'checkout', '-q', THEIRS);
  commitSide(dir, THEIRS);
  git(dir, 'checkout', '-q', OURS);
  const merge = git(dir, 'merge', '--no-edit', THEIRS);
  const conflicted = git(dir, 'diff', '--name-only', '--diff-filter=U')
    .out.split('\n')
    .filter(Boolean);
  if (merge.code === 0 || conflicted.length !== 2) {
    throw new Error(
      `probe setup: expected 2 conflicted files, got ${conflicted.join(', ') || 'none'}`
    );
  }
  return { dir, conflicted };
}

// ---------------------------------------------------------------- the CLI

function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  // The login shell's PATH, as the app resolves executables.
  const r = spawnSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8' });
  const path = (r.stdout ?? '').trim().split('\n').pop();
  return path && existsSync(path) ? path : null;
}

const CLAUDE = findClaude();

/** One headless run; resolves the CLI's JSON result or a failure reason. */
function runClaude({ prompt, cwd, extra, timeoutMs }) {
  const argv = [
    '-p',
    '--restricted',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--output-format',
    'json',
    '--model',
    model,
    '--max-budget-usd',
    budget,
    ...extra,
  ];
  const started = Date.now();
  const r = spawnSync(CLAUDE, argv, { cwd, input: prompt, encoding: 'utf8', timeout: timeoutMs });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (r.error) return { ok: false, reason: `${r.error.message} after ${seconds}s` };
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    const tail = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().slice(-600);
    return { ok: false, reason: `exit ${r.status}, no JSON result: ${tail}` };
  }
  return {
    ok: !json.is_error,
    reason: json.is_error ? String(json.result ?? json.subtype) : null,
    result: String(json.result ?? ''),
    cost: Number(json.total_cost_usd ?? 0),
    models: Object.keys(json.modelUsage ?? {}),
    turns: json.num_turns,
    seconds,
  };
}

// ---------------------------------------------------------------- assertions

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}

/** The panel's view of one conflicted file, built the way merge.rs builds it. */
function conflictDoc(dir, path) {
  const stage = (n) => git(dir, 'show', `:${n}:${path}`).out + '\n';
  const sides = { base: stage(1), ours: stage(2), theirs: stage(3) };
  const tmp = mkdtempSync(join(tmpdir(), 'merge-agent-probe-stages-'));
  for (const [name, text] of Object.entries(sides)) writeFileSync(join(tmp, name), text);
  // git2::merge_file with these labels is what the panel parses; merge-file is the CLI twin.
  const merged = spawnSync(
    'git',
    [
      'merge-file',
      '-p',
      '--diff3',
      '-L',
      OURS,
      '-L',
      'base',
      '-L',
      THEIRS,
      'ours',
      'base',
      'theirs',
    ],
    { cwd: tmp, encoding: 'utf8' }
  ).stdout;
  rmSync(tmp, { recursive: true, force: true });
  const doc = parseMergedText(merged, {
    labels: { ours: OURS, theirs: THEIRS, base: 'base' },
    sides,
  });
  return { doc, sides };
}

/** Mirrors mergeSlice's contextAround: other conflicts shown as chosen, else as our side. */
function contextAround(doc, resolutions, index) {
  const before = [];
  const after = [];
  let target = before;
  for (const seg of doc.segments) {
    if (seg.kind === 'clean') target.push(...seg.lines);
    else if (seg.kind === 'conflict' && seg.index === index) target = after;
    else if (seg.kind === 'conflict') {
      const chosen = resolutions[seg.index];
      target.push(...(chosen ? resolutionLines(seg, chosen) : seg.ours));
    }
  }
  return { before, after };
}

function subjectsSince(dir, ref, path) {
  const base = git(dir, 'merge-base', OURS, THEIRS).out;
  return git(dir, 'log', '--format=%s', `${base}..${ref}`, '--', path)
    .out.split('\n')
    .filter(Boolean);
}

// ---------------------------------------------------------------- case a

function caseProposals() {
  console.log(`\n[a] per-conflict proposals, model ${model}`);
  const { dir, conflicted } = makeConflictedRepo('a');
  let cost = 0;
  const models = new Set();
  for (const path of conflicted) {
    const { doc } = conflictDoc(dir, path);
    const conflicts = doc.segments.filter((s) => s.kind === 'conflict');
    console.log(`  ${path}: ${conflicts.length} conflict(s)`);
    // A file-level intent stands in for git_conflict_origins' per-line blame.
    const intent = intentFor({
      ours: subjectsSince(dir, OURS, path).map((summary) => ({ summary })),
      theirs: subjectsSince(dir, THEIRS, path).map((summary) => ({ summary })),
    });
    const resolutions = {};
    for (const conflict of conflicts) {
      const prompt = buildProposalPrompt({
        filePath: path,
        oursLabel: OURS,
        theirsLabel: THEIRS,
        conflict,
        ...contextAround(doc, resolutions, conflict.index),
        intent,
      });
      const run = runClaude({ prompt, cwd: dir, extra: ['--tools', ''], timeoutMs: 120_000 });
      if (!run.ok) {
        check(`${path} #${conflict.index} model answered`, false, run.reason);
        continue;
      }
      cost += run.cost;
      run.models.forEach((m) => models.add(m));
      const parsed = parseProposal(run.result, conflict);
      check(
        `${path} #${conflict.index} parseProposal accepts the answer`,
        parsed.ok,
        parsed.ok
          ? `${parsed.confidence}: ${parsed.rationale}`
          : `${parsed.reason} | raw: ${run.result.slice(0, 300)}`
      );
      if (parsed.ok) {
        resolutions[conflict.index] = { kind: 'custom', lines: parsed.lines, source: 'agent' };
        console.log(parsed.lines.map((l) => `        | ${l}`).join('\n'));
      }
    }
    const composed = composeResult(doc, resolutions);
    check(`${path} composes with every proposal used`, composed !== null);
    if (composed === null) continue;
    check(`${path} has no conflict marker`, !hasConflictMarkers(composed));
    const syntax = checkSyntax(path, composed);
    check(
      `${path} checkSyntax is ok`,
      syntax.kind === 'ok',
      `${syntax.checker} ${syntax.message ?? ''}`.trim()
    );
  }
  console.log(
    `  models: ${[...models].join(', ') || 'none'}; cost reported by the CLI: $${cost.toFixed(4)}`
  );
  return dir;
}

// ---------------------------------------------------------------- case b

const AGENT_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'];
const AGENT_ALLOWED = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(git add:*)',
  'Bash(git rm:*)',
  'Bash(git show:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git ls-files:*)',
  'Bash(git log:*)',
];

function caseResolveAll() {
  console.log(`\n[b] resolve all with an agent, model ${model}`);
  const { dir, conflicted } = makeConflictedRepo('b');
  const headBefore = git(dir, 'rev-parse', 'HEAD').out;
  const prompt = buildResolveAllPrompt({
    repoPath: dir,
    oursLabel: OURS,
    theirsLabel: THEIRS,
    conflicts: conflicted.map((path) => ({ path, kind: 'content' })),
  });
  const run = runClaude({
    prompt,
    cwd: dir,
    extra: [
      '--permission-mode',
      'acceptEdits',
      '--tools',
      AGENT_TOOLS.join(','),
      '--allowedTools',
      ...AGENT_ALLOWED,
    ],
    timeoutMs: 600_000,
  });
  if (!run.ok) {
    check('agent run finished', false, run.reason);
    return dir;
  }
  console.log(
    `  models: ${run.models.join(', ')}; turns ${run.turns}; ${run.seconds}s; cost reported by the CLI: $${run.cost.toFixed(4)}`
  );
  console.log(
    run.result
      .split('\n')
      .map((l) => `    > ${l}`)
      .join('\n')
  );
  check('no conflict entries left (git ls-files -u)', git(dir, 'ls-files', '-u').out === '');
  for (const path of conflicted) {
    const text = readFileSync(join(dir, path), 'utf8');
    check(`${path} has no marker line`, !hasConflictMarkers(text));
    const syntax = checkSyntax(path, text);
    check(
      `${path} checkSyntax is ok`,
      syntax.kind === 'ok',
      `${syntax.checker} ${syntax.message ?? ''}`.trim()
    );
  }
  const staged = git(dir, 'diff', '--cached', '--name-only').out.split('\n');
  const unstaged = git(dir, 'diff', '--name-only').out;
  check(
    'every resolved file is staged',
    conflicted.every((p) => staged.includes(p)),
    staged.join(', ')
  );
  check('nothing left unstaged', unstaged === '', unstaged);
  check(
    'MERGE_HEAD still present (no commit, no abort)',
    git(dir, 'rev-parse', '-q', '--verify', 'MERGE_HEAD').code === 0
  );
  check('HEAD unchanged', git(dir, 'rev-parse', 'HEAD').out === headBefore);
  return dir;
}

// ---------------------------------------------------------------- main

if (!CLAUDE) {
  console.log('claude CLI not found on the login shell PATH (set CLAUDE_BIN to point at it).');
  process.exit(2);
}
console.log(
  `claude: ${CLAUDE} (${spawnSync(CLAUDE, ['--version'], { encoding: 'utf8' }).stdout.trim()})`
);
const login = runClaude({
  prompt: 'Reply with OK.',
  cwd: tmpdir(),
  extra: ['--tools', ''],
  timeoutMs: 60_000,
});
if (!login.ok) {
  console.log(`claude CLI did not answer, likely not logged in: ${login.reason}`);
  process.exit(2);
}

const dirs = [];
if (!only || only.includes('a')) dirs.push(caseProposals());
if (!only || only.includes('b')) dirs.push(caseResolveAll());

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (keep) console.log(`repos kept: ${dirs.join(' ')}`);
else for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);
