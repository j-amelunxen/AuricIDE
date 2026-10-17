#!/usr/bin/env node
// Builds the throwaway world for the supervisor-link end-to-end run:
//   <base>/home      fake HOME (app data dir inside), reachable as the short symlink <short>
//   <base>/run       cwd for the isolated app (holds dynamic-providers/)
//   <base>/proj      a git project with scene files copied from the architecture-scene examples
//   <base>/hidden    a git project that is NOT listed in the link policy
// Env: ARCH_ROOT (repo with dist/cli.js + examples/), E2E_BASE (/tmp/e2e-link), E2E_SHORT (/tmp/auric-iso)
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';

const ARCH = process.env.ARCH_ROOT;
if (!ARCH) throw new Error('set ARCH_ROOT to the scene format repo');
const BASE = process.env.E2E_BASE ?? '/tmp/e2e-link';
const SHORT = process.env.E2E_SHORT ?? '/tmp/auric-iso';
const INSTR = process.env.INSTRUCTIONS_TEMPLATE;
if (!INSTR)
  throw new Error('set INSTRUCTIONS_TEMPLATE to the instructions file of the scene.draw job kind');
const DATA = join(BASE, 'home/Library/Application Support/com.auricide.ide');
const PROJ = join(BASE, 'proj');
const HIDDEN = join(BASE, 'hidden');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const w = (p, text, mode) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
  if (mode) chmodSync(p, mode);
};

rmSync(BASE, { recursive: true, force: true });
rmSync(SHORT, { force: true });
mkdirSync(DATA, { recursive: true });
symlinkSync(join(BASE, 'home'), SHORT);

for (const dir of [PROJ, HIDDEN]) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'e2e@example.invalid');
  git(dir, 'config', 'user.name', 'e2e');
}
// tiny code base for the runtime / observability modules
w(join(PROJ, 'package.json'), '{ "name": "demo-platform", "version": "0.0.1", "private": true }\n');
w(
  join(PROJ, 'src/main.ts'),
  "import { schedule } from './runtime/scheduler';\nimport { info } from './observability/logger';\ninfo('boot');\nschedule(() => {});\n"
);
w(
  join(PROJ, 'src/runtime/scheduler.ts'),
  "import { run } from './executor';\nexport const schedule = (job: () => void) => run(job);\n"
);
w(
  join(PROJ, 'src/runtime/executor.ts'),
  "import { get } from './cache';\nexport const run = (job: () => void) => { get('k'); job(); };\n"
);
w(
  join(PROJ, 'src/runtime/cache.ts'),
  'const m = new Map<string, string>();\nexport const get = (k: string) => m.get(k);\n'
);
w(
  join(PROJ, 'src/observability/logger.ts'),
  "import { count } from './metrics';\nexport const info = (m: string) => { count('log'); console.log(m); };\n"
);
w(
  join(PROJ, 'src/observability/metrics.ts'),
  'const c: Record<string, number> = {};\nexport const count = (k: string) => (c[k] = (c[k] ?? 0) + 1);\n'
);
w(join(HIDDEN, 'README.md'), 'hidden\n');
// scenes
const arch = join(PROJ, 'docs/architecture');
mkdirSync(arch, { recursive: true });
cpSync(join(ARCH, 'examples/drilldown/platform.scene.json'), join(arch, 'system.scene.json'));
cpSync(join(ARCH, 'examples/drilldown/runtime.scene.json'), join(arch, 'runtime.scene.json'));
cpSync(join(ARCH, 'examples/drilldown/storage.scene.json'), join(arch, 'storage.scene.json'));
cpSync(join(ARCH, 'examples/small-system/checkout.scene.json'), join(arch, 'checkout.scene.json'));
cpSync(join(ARCH, 'schema/scene.v1.schema.json'), join(PROJ, 'docs/scene.v1.schema.json'));
// the node whose sub-scene is missing
const sysPath = join(arch, 'system.scene.json');
const sys = JSON.parse(readFileSync(sysPath, 'utf8'));
sys.nodes.find((n) => n.id === 'observability').detail = './observability.scene.json';
writeFileSync(sysPath, JSON.stringify(sys, null, 2) + '\n');
mkdirSync(join(PROJ, 'docs/agents'), { recursive: true });
cpSync(INSTR, join(PROJ, 'docs/agents/scene-draw.md'));
git(PROJ, 'add', '-A');
git(PROJ, 'commit', '-q', '-m', 'initial');
git(HIDDEN, 'add', '-A');
git(HIDDEN, 'commit', '-q', '-m', 'initial');

// dummy provider (a shell script that plays the job agent)
const bin = join(BASE, 'bin');
mkdirSync(bin, { recursive: true });
cpSync(new URL('./dummy-agent.sh', import.meta.url), join(bin, 'dummy-agent.sh'));
chmodSync(join(bin, 'dummy-agent.sh'), 0o755);
mkdirSync(join(BASE, 'logs'), { recursive: true });
const run = join(BASE, 'run');
w(
  join(run, 'dynamic-providers/dummy.json'),
  JSON.stringify(
    {
      id: 'dummy',
      name: 'Dummy',
      executable: join(bin, 'dummy-agent.sh'),
      arguments: [
        { type: 'model', flag: '--model', ignoreIfAuto: true },
        { type: 'headless', flag: '-p' },
        { type: 'task', quote: true },
        { type: 'permission', map: { default: '', acceptEdits: '' }, fallback: '' },
      ],
      projectBinding: {
        arguments: [],
        environment: { DUMMY_LOG_DIR: join(BASE, 'logs'), ARCH_ROOT: ARCH },
      },
      info: {
        models: [
          { value: 'dummy-small', label: 'Small', rank: 1 },
          { value: 'dummy-big', label: 'Big', rank: 3 },
        ],
        permissionModes: [{ value: 'default', label: 'Interactive', description: 'attended' }],
        defaultModel: 'dummy-small',
        defaultPermissionMode: 'default',
      },
      versionCheck: { command: 'true', args: [] },
      promptTemplate: 'dummy -p "',
    },
    null,
    2
  )
);

// policies
const policy = {
  version: 1,
  supervisor: { provider: 'dummy', model: 'dummy-small', chrome: false },
  maxRunningChildren: 4,
  projects: {
    [PROJ]: {
      allowed: true,
      providers: ['dummy'],
      models: {},
      permissionMode: { dummy: 'default' },
      allowInteractive: true,
      maxRunning: 3,
    },
  },
};
w(join(DATA, 'supervisor-policy.json'), JSON.stringify(policy, null, 2), 0o600);
const linkCfg = {
  version: 2,
  projects: {
    [PROJ]: {
      documentTypes: [
        {
          name: 'scene',
          globs: ['docs/**/*.scene.json'],
          nameField: 'hud.title',
          descriptionField: 'hud.subtitle',
          schema: 'docs/scene.v1.schema.json',
        },
      ],
      jobKinds: [
        {
          kind: 'scene.draw',
          instructions: 'docs/agents/scene-draw.md',
          writes: ['docs/**/*.scene.json', 'docs/**/assets/*.glb'],
        },
      ],
    },
  },
  jobs: { dailyLimit: 20, perProjectDailyLimit: null },
};
w(join(DATA, 'supervisor-link.json'), JSON.stringify(linkCfg, null, 2), 0o600);
console.log(
  JSON.stringify(
    {
      base: BASE,
      short: SHORT,
      proj: PROJ,
      hidden: HIDDEN,
      run,
      data: DATA,
      socket: join(SHORT, 'Library/Application Support/com.auricide.ide/supervisor-link.sock'),
    },
    null,
    2
  )
);
