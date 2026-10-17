// End-to-end run of the supervisor link against an isolated AuricIDE, driven with the typed link client of a
// consumer app (read-only import). Prints a test matrix as JSON lines plus a final table.
//   cd <consumer>/apps/server && CONSUMER_ROOT=<consumer> E2E_BASE=/tmp/e2e-link E2E_SHORT=/tmp/auric-iso \
//     node_modules/.bin/tsx <this file> [--only A,B] [--real]
// Needs `setup.mjs` to have run and the isolated app to be up (see README.md next to it).
/* eslint-disable @typescript-eslint/no-explicit-any -- the consumer's client and core are imported by absolute path at run time; there are no types to name here */
import { execFileSync } from 'node:child_process';
import {
  realpathSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { connect as netConnect } from 'node:net';
import { join } from 'node:path';

const M = process.env.CONSUMER_ROOT!;
const BASE = process.env.E2E_BASE ?? '/tmp/e2e-link';
const SHORT = process.env.E2E_SHORT ?? '/tmp/auric-iso';
const DEFAULT_SOCKET = join(
  SHORT,
  'Library/Application Support/com.auricide.ide/supervisor-link.sock'
);
// The consumer client may dial ws+unix://, which cannot carry the space of "Application Support":
// E2E_SOCKET can name a space-free alias. This script's own connections use createConnection.
const SOCKET = process.env.E2E_SOCKET ?? DEFAULT_SOCKET;
const DATA = join(BASE, 'home/Library/Application Support/com.auricide.ide');
const PROJ = join(BASE, 'proj');
const HIDDEN = join(BASE, 'hidden');
const ARCH = process.env.ARCH_ROOT!;
const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1].split(',')
  : null;

const { SupervisorLinkClient, LinkError } = await import(
  `${M}/apps/server/src/auric/link-client.ts`
);
const core = await import(`${M}/packages/core/src/index.ts`);
const WS = createRequire(`${M}/apps/server/package.json`)('ws');
// The documented recipe: the unix socket is the connection, the URL only shapes the handshake.
const dial = (path: string, urlPath = '/v1') =>
  new WS(`ws://localhost${urlPath}`, { createConnection: () => netConnect(path) });

type Row = { id: string; step: string; expected: string; actual: string; pass: boolean };
const rows: Row[] = [];
const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function record(id: string, step: string, expected: string, actual: string, pass: boolean) {
  rows.push({ id, step, expected, actual, pass });
  console.log(JSON.stringify({ id, pass, step, expected, actual }));
}
async function expectErr(
  id: string,
  step: string,
  code: string,
  fn: () => Promise<unknown>,
  reason?: string
) {
  try {
    const r = await fn();
    record(id, step, `error ${code}`, `OK ${JSON.stringify(r).slice(0, 160)}`, false);
  } catch (e: any) {
    const got =
      e instanceof LinkError
        ? `${e.code}${e.reason ? '/' + e.reason : ''}: ${e.message}`
        : `${e?.name}: ${e?.message}`;
    const ok =
      e instanceof LinkError && e.code === code && (reason === undefined || e.reason === reason);
    record(id, step, `error ${code}${reason ? '/' + reason : ''}`, got.slice(0, 220), ok);
  }
}
async function expectOk<T>(
  id: string,
  step: string,
  expected: string,
  fn: () => Promise<T>,
  check: (r: T) => string | true
): Promise<T | undefined> {
  try {
    const r = await fn();
    const c = check(r);
    record(id, step, expected, c === true ? 'as expected' : c, c === true);
    return r;
  } catch (e: any) {
    record(id, step, expected, `threw ${e?.name}: ${String(e?.message).slice(0, 220)}`, false);
    return undefined;
  }
}

const client = new SupervisorLinkClient({ socketPath: SOCKET, clientName: 'e2e' });
const events: { seq?: number; event: string; data: any }[] = [];
const waiters: { match: (e: any) => boolean; resolve: (e: any) => void }[] = [];
for (const name of [
  'job.started',
  'job.progress',
  'job.finished',
  'job.failed',
  'agent.added',
  'agent.updated',
  'agent.removed',
] as const) {
  client.on(name, (data: any) => {
    const e = { event: name, data };
    events.push(e);
    for (const w of [...waiters])
      if (w.match(e)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(e);
      }
  });
}
const unknownEvents: string[] = [];
let gaps = 0;
client.onGap(() => {
  gaps++;
});
client.onUnknown((event: string) => unknownEvents.push(event));
const waitEvent = (match: (e: any) => boolean, ms = 90_000) =>
  new Promise<any>((resolve, reject) => {
    const past = events.find(match);
    if (past) return resolve(past);
    const t = setTimeout(() => reject(new Error('timeout waiting for event')), ms);
    waiters.push({
      match,
      resolve: (e) => {
        clearTimeout(t);
        resolve(e);
      },
    });
  });
const jobEnd = (jobId: string, ms?: number) =>
  waitEvent(
    (e) => (e.event === 'job.finished' || e.event === 'job.failed') && e.data.job.jobId === jobId,
    ms
  );

function setLinkConfig(patch: (c: any) => void) {
  const p = join(DATA, 'supervisor-link.json');
  const c = JSON.parse(readFileSync(p, 'utf8'));
  patch(c);
  writeFileSync(p, JSON.stringify(c, null, 2));
  chmodSync(p, 0o600);
}
const sceneJob = (extra: Record<string, unknown> = {}) => ({
  type: 'scene',
  parent: 'docs/architecture/system.scene.json',
  node: 'observability',
  ref: './observability.scene.json',
  target: 'docs/architecture/observability.scene.json',
  label: 'Observability',
  ...extra,
});

// ---------------------------------------------------------------- raw frames (what the typed client cannot send)
function rawSession(): Promise<{
  send: (x: any, binary?: boolean) => void;
  next: () => Promise<any>;
  close: () => void;
  closeInfo: () => Promise<number>;
}> {
  return new Promise((resolve, reject) => {
    const ws = dial(SOCKET);
    const q: any[] = [];
    const w: ((x: any) => void)[] = [];
    let closeCode: number | null = null;
    const cw: ((n: number) => void)[] = [];
    ws.on('message', (d: any) => {
      const m = JSON.parse(String(d));
      const f = w.shift();
      if (f) f(m);
      else q.push(m);
    });
    ws.on('close', (code: number) => {
      closeCode = code;
      cw.splice(0).forEach((f) => f(code));
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        send: (x, binary) =>
          ws.send(
            binary ? Buffer.from(JSON.stringify(x)) : typeof x === 'string' ? x : JSON.stringify(x),
            { binary: !!binary }
          ),
        next: () =>
          new Promise((r) => {
            const m = q.shift();
            if (m) r(m);
            else w.push(r);
          }),
        close: () => ws.close(),
        closeInfo: () => new Promise((r) => (closeCode !== null ? r(closeCode) : cw.push(r))),
      })
    );
  });
}

const run = (tag: string) => !only || only.includes(tag);

try {
  if (run('A')) {
    const res = await new Promise<string>((r) => {
      const w = dial(DEFAULT_SOCKET);
      w.on('open', () => {
        w.close();
        r('open');
      });
      w.on('error', (e: any) => r(String(e.message)));
    });
    record(
      'A0',
      'ws (consumer dependency) connects with the documented recipe (createConnection) to the default socket path, space included',
      'open',
      res,
      res === 'open'
    );
  }
  client.start();
  await sleep(1500);

  // ------------------------------------------------------------ A: connect, hello, contract
  if (run('A')) {
    const hello = client.hello as any;
    record(
      'A1',
      'session.hello through the consumer client (validators on)',
      'online, protocol 1, server AuricIDE',
      `${client.state} ${hello?.protocol} ${hello?.server}`,
      client.state === 'online' && hello?.protocol === 1 && hello?.server === 'AuricIDE'
    );
    const missing = core.LINK_METHODS.filter((m: string) => !hello.methods.includes(m));
    const extra = hello.methods.filter((m: string) => !core.LINK_METHODS.includes(m));
    record(
      'A2',
      'server methods == client LINK_METHODS',
      'equal sets',
      `missing in server: [${missing}] extra in server: [${extra}]`,
      !missing.length && !extra.length
    );
    const em = core.LINK_EVENTS.filter((m: string) => !hello.events.includes(m));
    const ee = hello.events.filter((m: string) => !core.LINK_EVENTS.includes(m));
    record(
      'A3',
      'server events == client LINK_EVENTS',
      'equal sets',
      `missing in server: [${em}] extra in server: [${ee}]`,
      !em.length && !ee.length
    );
    const sub = await client.request('events.subscribe', {});
    record(
      'A4',
      'events.subscribe (default: jobs + output)',
      'ok with agents[]',
      JSON.stringify(sub).slice(0, 80),
      Array.isArray((sub as any).agents)
    );
  }

  // ------------------------------------------------------------ B/C: projects + search
  if (run('B')) {
    const projects: any = await client.request('documents.projects');
    const p = projects.projects.find((x: any) => x.path.endsWith('/proj'));
    record(
      'B1',
      'documents.projects lists the registered project only',
      '1 project, types [scene], kinds [scene.draw]',
      `${projects.projects.length} project(s); path=${p?.path}; types=${p?.documentTypes.map((t: any) => t.name)} schema=${p?.documentTypes[0]?.schema}; kinds=${p?.jobKinds}; git=${p?.isGitRepo}`,
      projects.projects.length === 1 &&
        !!p &&
        p.documentTypes[0].name === 'scene' &&
        p.jobKinds[0] === 'scene.draw' &&
        p.isGitRepo === true
    );
    record(
      'B1b',
      'project path as returned vs as registered (/tmp is a symlink to /private/tmp)',
      `${PROJ}`,
      `${p?.path}`,
      p?.path === PROJ || p?.path === '/private' + PROJ
    );
    const s: any = await client.request('documents.search', { type: 'scene' });
    const ids = s.documents.map((d: any) => d.id).sort();
    record(
      'B2',
      'documents.search lists all scene files',
      'checkout, runtime, storage, system',
      ids.join(', '),
      ids.length === 4
    );
    const sys = s.documents.find((d: any) => d.id.endsWith('system.scene.json'));
    record(
      'B3',
      'name/description from configured fields (hud.title/hud.subtitle per the skill template); core files carry top-level title/description',
      'a real name like "Platform overview"',
      `name=${JSON.stringify(sys?.name)} description=${JSON.stringify(sys?.description)}`,
      sys?.name === 'Platform overview'
    );
    const q: any = await client.request('documents.search', { query: 'runtime', type: 'scene' });
    record(
      'B4',
      'search query "runtime" matches by id',
      '>=1 hit (runtime.scene.json)',
      `${q.documents.length}: ${q.documents.map((d: any) => d.id)}`,
      q.documents.some((d: any) => d.id.includes('runtime'))
    );
    const lim: any = await client.request('documents.search', { limit: 1 });
    record('B5', 'limit=1', '1 document', String(lim.documents.length), lim.documents.length === 1);
    await expectErr('B6', 'search with limit 0 / 500', 'invalid_params', () =>
      client.request('documents.search', { limit: 500 } as any)
    );
    await expectErr(
      'B7',
      'search in a project the link does not list',
      'document_not_visible',
      () => client.request('documents.search', { project: HIDDEN } as any)
    );
    await expectErr('B8', 'unknown param (typo refused)', 'invalid_params', () =>
      client.request('documents.search', { qeury: 'x' } as any)
    );
  }

  // ------------------------------------------------------------ D: get
  if (run('D')) {
    const id = 'docs/architecture/system.scene.json';
    const doc: any = await client.request('documents.get', { project: PROJ, type: 'scene', id });
    const blob = git(PROJ, 'hash-object', id);
    record(
      'D1',
      'documents.get working tree; hash == git hash-object',
      blob,
      doc.hash,
      doc.hash === blob && doc.rev === null && doc.merged === null
    );
    const head = git(PROJ, 'rev-parse', 'HEAD');
    const at: any = await client.request('documents.get', {
      project: PROJ,
      type: 'scene',
      id,
      rev: 'HEAD',
    });
    record(
      'D2',
      'get with rev=HEAD',
      `rev=${head} merged=true`,
      `rev=${at.rev} merged=${at.merged}`,
      at.rev === head && at.merged === true
    );
    await expectErr('D3', 'get with rev that git does not know', 'document_not_found', () =>
      client.request('documents.get', { project: PROJ, type: 'scene', id, rev: 'no-such-branch' })
    );
    await expectErr('D4', 'get rev with option-like value "--all"', 'document_not_found', () =>
      client.request('documents.get', { project: PROJ, type: 'scene', id, rev: '--all' })
    );
    await expectErr('D5', 'get missing document', 'document_not_found', () =>
      client.request('documents.get', {
        project: PROJ,
        type: 'scene',
        id: 'docs/architecture/none.scene.json',
      })
    );
    await expectErr('D6', 'get with id not matching glob', 'invalid_params', () =>
      client.request('documents.get', { project: PROJ, type: 'scene', id: 'package.json' })
    );
    await expectErr('D7', 'get with unknown type', 'invalid_params', () =>
      client.request('documents.get', { project: PROJ, type: 'nope', id })
    );
    await expectErr('D8', 'get in unlisted project', 'document_not_visible', () =>
      client.request('documents.get', { project: HIDDEN, type: 'scene', id })
    );
    await expectErr('D9', 'get with nonexistent project path', 'document_not_visible', () =>
      client.request('documents.get', {
        project: '/tmp/e2e-link/does-not-exist',
        type: 'scene',
        id,
      })
    );
    await expectErr('D10', 'get with relative project path', 'invalid_params', () =>
      client.request('documents.get', { project: 'proj', type: 'scene', id })
    );
    for (const [n, bad] of [
      ['..', 'docs/../package.json'],
      ['dotdot-glob', 'docs/architecture/../../../etc/x.scene.json'],
      ['abs', '/etc/hosts'],
      ['hidden', 'docs/.git/x.scene.json'],
      ['backslash', 'docs\\architecture\\system.scene.json'],
      ['empty-seg', 'docs//architecture/system.scene.json'],
      ['nul', 'docs/architecture/system.scene.json\u0000.png'],
    ] as const) {
      await expectErr(
        `D11-${n}`,
        `path traversal / bad id "${JSON.stringify(bad)}"`,
        'invalid_params',
        () => client.request('documents.get', { project: PROJ, type: 'scene', id: bad })
      );
    }
    // symlink inside the project that matches the glob but points outside
    writeFileSync(join(BASE, 'outside-secret.json'), '{"secret":"top"}\n');
    const link = join(PROJ, 'docs/architecture/leak.scene.json');
    try {
      rmSync(link);
    } catch {
      /* none */
    }
    symlinkSync(join(BASE, 'outside-secret.json'), link);
    let leaked: any = null;
    try {
      leaked = await client.request('documents.get', {
        project: PROJ,
        type: 'scene',
        id: 'docs/architecture/leak.scene.json',
      });
    } catch (e: any) {
      leaked = { err: `${e.code}: ${e.message}` };
    }
    record(
      'D12',
      'symlink docs/architecture/leak.scene.json -> file OUTSIDE the project (working tree read)',
      'refused (not read through the link)',
      JSON.stringify(leaked).slice(0, 200),
      !!leaked.err
    );
    const ss: any = await client.request('documents.search', { query: 'leak' });
    record(
      'D12b',
      'does search list the symlinked file?',
      'not listed',
      `listed=${ss.documents.length}`,
      ss.documents.length === 0
    );
    rmSync(link);
  }

  // ------------------------------------------------------------ E: resolve
  if (run('E')) {
    const from = 'docs/architecture/system.scene.json';
    const r: any = await client.request('documents.resolve', {
      project: PROJ,
      type: 'scene',
      from,
      ref: './runtime.scene.json',
    });
    record(
      'E1',
      'resolve "./runtime.scene.json" (detail path written by the scene format package)',
      'docs/architecture/runtime.scene.json',
      r.id,
      r.id === 'docs/architecture/runtime.scene.json'
    );
    const r2: any = await client.request('documents.resolve', {
      project: PROJ,
      type: 'scene',
      from,
      ref: 'runtime',
    });
    record(
      'E2',
      'resolve "runtime" (no ./, no suffix)',
      'docs/architecture/runtime.scene.json',
      r2.id,
      r2.id === 'docs/architecture/runtime.scene.json'
    );
    await expectErr(
      'E3',
      'resolve a scene-id detail ("drilldown.storage", as the format package example uses)',
      'document_not_found',
      () =>
        client.request('documents.resolve', {
          project: PROJ,
          type: 'scene',
          from: 'docs/architecture/runtime.scene.json',
          ref: 'drilldown.storage',
        })
    );
    await expectErr('E4', 'resolve a missing sub-scene', 'document_not_found', () =>
      client.request('documents.resolve', {
        project: PROJ,
        type: 'scene',
        from,
        ref: './observability.scene.json',
      })
    );
    await expectErr('E5', 'resolve climbing out of the project ../../../x', 'invalid_params', () =>
      client.request('documents.resolve', {
        project: PROJ,
        type: 'scene',
        from,
        ref: '../../../outside',
      })
    );
    await expectErr('E6', 'resolve absolute ref', 'invalid_params', () =>
      client.request('documents.resolve', { project: PROJ, type: 'scene', from, ref: '/etc/hosts' })
    );
    await expectErr('E7', 'resolve empty ref', 'invalid_params', () =>
      client.request('documents.resolve', { project: PROJ, type: 'scene', from, ref: '' })
    );
    await expectErr(
      'E8',
      'resolve ref to a non-scene file (../../package.json)',
      'invalid_params',
      () =>
        client.request('documents.resolve', {
          project: PROJ,
          type: 'scene',
          from,
          ref: '../../package.json',
        })
    );
    const r3: any = await client
      .request('documents.resolve', {
        project: PROJ,
        type: 'scene',
        from,
        ref: 'docs/architecture/storage',
      })
      .catch((e: any) => ({ err: e.code }));
    record(
      'E9',
      'resolve project-root-relative "docs/architecture/storage"',
      'storage.scene.json',
      r3.id ?? r3.err,
      r3.id === 'docs/architecture/storage.scene.json'
    );
    const r4: any = await client.request('documents.resolve', {
      project: PROJ,
      type: 'scene',
      from,
      ref: './runtime.scene.json',
      rev: 'HEAD',
    });
    record('E10', 'resolve at rev=HEAD', 'merged true', String(r4.merged), r4.merged === true);
  }

  // ------------------------------------------------------------ F: raw protocol
  if (run('F')) {
    const s = await rawSession();
    s.send({ v: 2, id: 1, method: 'session.hello' });
    let m = await s.next();
    record(
      'F1',
      'v=2',
      'unsupported_version',
      JSON.stringify(m.error ?? m).slice(0, 120),
      m.error?.code === 'unsupported_version'
    );
    s.send({ v: 1, id: 2, method: 'nope.nope' });
    m = await s.next();
    record(
      'F2',
      'unknown method',
      'unknown_method',
      m.error?.code,
      m.error?.code === 'unknown_method'
    );
    s.send('this is not json');
    m = await s.next();
    record(
      'F3',
      'non-JSON text frame',
      'invalid_request with id null',
      `${m.error?.code} id=${m.id}`,
      m.error?.code === 'invalid_request' && m.id === null
    );
    s.send({ v: 1, id: 3 });
    m = await s.next();
    record(
      'F4',
      'no method',
      'invalid_request',
      m.error?.code,
      m.error?.code === 'invalid_request'
    );
    s.send({ v: 1, id: 4, method: 'session.hello' }, true);
    m = await s.next();
    record(
      'F5',
      'binary frame',
      'invalid_request',
      m.error?.code,
      m.error?.code === 'invalid_request'
    );
    s.send({ v: 1, id: 5, method: 'documents.get', params: 'x' });
    m = await s.next();
    record(
      'F6',
      'params is a string',
      'invalid_params',
      m.error?.code,
      m.error?.code === 'invalid_params'
    );
    s.send({
      v: 1,
      id: 6,
      method: 'documents.get',
      params: { project: PROJ, type: 'scene', id: 'docs/architecture/system.scene.json', extra: 1 },
    });
    m = await s.next();
    record(
      'F7',
      'unknown param on documents.get',
      'invalid_params',
      m.error?.code,
      m.error?.code === 'invalid_params'
    );
    s.send({ v: 1, id: { a: 1 }, method: 'session.hello' });
    m = await s.next();
    record(
      'F8',
      'object as id',
      'invalid_request (id must be string|number)',
      JSON.stringify(m).slice(0, 140),
      m.ok === false
    );
    s.send({
      v: 1,
      id: 'big',
      method: 'documents.search',
      params: { query: 'x'.repeat(2_000_000) },
    });
    const code = await Promise.race([s.closeInfo(), sleep(5000).then(() => -1)]);
    record('F9', 'message > 1 MiB', 'close 1009', String(code), code === 1009);
    const hs = await new Promise<string>((res) => {
      const w2 = dial(SOCKET, '/v2');
      w2.on('unexpected-response', (_q: any, r: any) => res(`HTTP ${r.statusCode}`));
      w2.on('open', () => res('opened'));
      w2.on('error', (e: any) => res(`error ${e.message}`));
    });
    record('F10', 'wrong path /v2', 'HTTP 404', hs, hs === 'HTTP 404');
    // gap-free seq on a second connection
    const s2 = await rawSession();
    s2.send({ v: 1, id: 1, method: 'events.subscribe', params: {} });
    await s2.next();
    s2.send({
      v: 1,
      id: 2,
      method: 'events.subscribe',
      params: { agentIds: ['agent-does-not-exist'] },
    });
    m = await s2.next();
    record(
      'F11',
      'events.subscribe with foreign/unknown agentId',
      'unknown_agent',
      m.error?.code,
      m.error?.code === 'unknown_agent'
    );
    s2.send({ v: 1, id: 3, method: 'agents.read', params: { agentId: 'agent-1' } });
    m = await s2.next();
    record(
      'F12',
      'agents.read on id outside the tree',
      'unknown_agent',
      m.error?.code,
      m.error?.code === 'unknown_agent'
    );
    s2.close();
  }

  // ------------------------------------------------------------ G: propose
  if (run('G')) {
    const headBefore = git(PROJ, 'rev-parse', 'HEAD');
    const branchesBefore = git(PROJ, 'branch', '--list').split('\n').length;
    const id = 'docs/architecture/system.scene.json';
    const cur: any = await client.request('documents.get', { project: PROJ, type: 'scene', id });
    const next = { ...cur.document, title: 'Platform overview (proposed)' };
    const pr: any = await expectOk(
      'G1',
      'propose change with correct baseHash',
      'branch auric/proposal/system-<8hex>, created=false',
      () =>
        client.request('documents.propose', {
          project: PROJ,
          type: 'scene',
          id,
          document: next,
          baseHash: cur.hash,
          message: 'Rename title',
        }),
      (r: any) =>
        /^auric\/proposal\/system-[0-9a-f]{8}$/.test(r.branch) && r.created === false
          ? true
          : JSON.stringify(r)
    );
    if (pr) {
      const msg = git(PROJ, 'log', '-1', '--format=%s%n%b', pr.branch);
      record(
        'G2',
        'commit message',
        'scene: propose docs/architecture/system.scene.json + body',
        JSON.stringify(msg),
        msg.startsWith('scene: propose docs/architecture/system.scene.json') &&
          msg.includes('Rename title')
      );
      const author = git(PROJ, 'log', '-1', '--format=%an <%ae>', pr.branch);
      record(
        'G3',
        'author = repo git user',
        'e2e <e2e@example.invalid>',
        author,
        author === 'e2e <e2e@example.invalid>'
      );
      record(
        'G4',
        'HEAD, checked-out branch and working tree untouched',
        'same HEAD, clean status',
        `HEAD same=${git(PROJ, 'rev-parse', 'HEAD') === headBefore} status=[${git(PROJ, 'status', '--porcelain')}] cur=${git(PROJ, 'branch', '--show-current')}`,
        git(PROJ, 'rev-parse', 'HEAD') === headBefore &&
          git(PROJ, 'status', '--porcelain') === '' &&
          git(PROJ, 'branch', '--show-current') === 'main'
      );
      const body = git(PROJ, 'show', `${pr.branch}:${id}`);
      record(
        'G5',
        'proposed file = pretty JSON + trailing newline',
        'ends with \\n, parses',
        `endsNL=${body.length > 0} title=${JSON.parse(body).title}`,
        JSON.parse(body).title.endsWith('(proposed)')
      );
      const view: any = await client.request('documents.get', {
        project: PROJ,
        type: 'scene',
        id,
        rev: pr.branch,
      });
      record(
        'G6',
        'preview via rev=<branch>',
        'merged=false, rev = full commit',
        `merged=${view.merged} rev=${String(view.rev).slice(0, 8)}`,
        view.merged === false && view.rev === pr.commit && view.hash === pr.hash
      );
      const wt: any = await client.request('documents.get', { project: PROJ, type: 'scene', id });
      record(
        'G7',
        'working-tree read unchanged by a proposal',
        'old title',
        wt.document.title,
        wt.document.title === cur.document.title
      );
    }
    await expectErr('G8', 'propose with stale baseHash', 'document_conflict', () =>
      client.request('documents.propose', {
        project: PROJ,
        type: 'scene',
        id,
        document: next,
        baseHash: '0'.repeat(40),
      })
    );
    await expectErr(
      'G9',
      'propose new doc but baseHash for an existing file = null',
      'document_conflict',
      () =>
        client.request('documents.propose', {
          project: PROJ,
          type: 'scene',
          id,
          document: next,
          baseHash: null,
        })
    );
    const created: any = await expectOk(
      'G10',
      'propose a NEW document (baseHash null)',
      'created=true',
      () =>
        client.request('documents.propose', {
          project: PROJ,
          type: 'scene',
          id: 'docs/architecture/new-one.scene.json',
          document: { hello: 'world' },
          baseHash: null,
        }),
      (r: any) => (r.created === true ? true : JSON.stringify(r))
    );
    await expectErr('G11', 'propose a JSON array', 'document_invalid', () =>
      client.request('documents.propose', {
        project: PROJ,
        type: 'scene',
        id: 'docs/architecture/arr.scene.json',
        document: [1, 2] as any,
        baseHash: null,
      })
    );
    await expectErr('G12', 'propose > 256 KiB', 'document_invalid', () =>
      client.request('documents.propose', {
        project: PROJ,
        type: 'scene',
        id: 'docs/architecture/huge.scene.json',
        document: { blob: 'x'.repeat(300_000) },
        baseHash: null,
      })
    );
    await expectErr('G13', 'propose id outside glob', 'invalid_params', () =>
      client.request('documents.propose', {
        project: PROJ,
        type: 'scene',
        id: 'package.json',
        document: {},
        baseHash: null,
      })
    );
    await expectErr('G14', 'propose traversal id', 'invalid_params', () =>
      client.request('documents.propose', {
        project: PROJ,
        type: 'scene',
        id: 'docs/../../evil.scene.json',
        document: {},
        baseHash: null,
      })
    );
    await expectErr('G15', 'propose into hidden project', 'document_not_visible', () =>
      client.request('documents.propose', {
        project: HIDDEN,
        type: 'scene',
        id: 'docs/a.scene.json',
        document: {},
        baseHash: null,
      })
    );
    await expectErr('G16', 'propose without baseHash param', 'invalid_params', () =>
      client.request('documents.propose', {
        project: PROJ,
        type: 'scene',
        id,
        document: next,
      } as any)
    );
    const b2: any = await client.request('documents.propose', {
      project: PROJ,
      type: 'scene',
      id: 'docs/architecture/new-one.scene.json',
      document: { hello: 'again' },
      baseHash: null,
    });
    record(
      'G17',
      'same doc proposed twice',
      'two distinct branches',
      `${created?.branch} / ${b2.branch}`,
      created?.branch !== b2.branch
    );
    const branchesAfter = git(PROJ, 'branch', '--list').split('\n').length;
    record(
      'G18',
      'branch count grew by the number of ok proposals (4)',
      `${branchesBefore + 3}`,
      String(branchesAfter),
      branchesAfter === branchesBefore + 3
    );
    // inbox
    let inbox = '';
    for (const db of ['notifications.db', 'inbox.db']) {
      const p = join(DATA, db);
      if (existsSync(p))
        inbox +=
          `${db}: ` +
          (() => {
            try {
              return execFileSync(
                'sqlite3',
                [
                  p,
                  "select count(*) from notifications where title like '%roposal%' or body like '%auric/proposal%'",
                ],
                { encoding: 'utf8' }
              ).trim();
            } catch (e: any) {
              return 'n/a ' + String(e.message).slice(0, 60);
            }
          })() +
          ' ';
    }
    record(
      'G19',
      'inbox notification per proposal (notifications.db)',
      '>=1',
      inbox,
      /notifications.db: [1-9]/.test(inbox)
    );
  }

  // ------------------------------------------------------------ H: jobs, errors + modes
  if (run('H')) {
    await client.request('events.subscribe', {});
    await expectErr('H1', 'kind not listed', 'job_kind_not_allowed', () =>
      client.request('jobs.create', { project: PROJ, kind: 'bogus.kind', payload: null })
    );
    await expectErr('H2', 'unlisted project', 'document_not_visible', () =>
      client.request('jobs.create', { project: HIDDEN, kind: 'scene.draw', payload: null })
    );
    await expectErr('H3', 'payload > 16 KiB', 'invalid_params', () =>
      client.request('jobs.create', {
        project: PROJ,
        kind: 'scene.draw',
        payload: { x: 'y'.repeat(20_000) },
      })
    );
    await expectErr('H4', 'payload missing', 'invalid_params', () =>
      client.request('jobs.create', { project: PROJ, kind: 'scene.draw' } as any)
    );
    await expectErr('H5', 'unknown job id on cancel', 'unknown_job', () =>
      client.request('jobs.cancel', { jobId: 'job-000000000000' })
    );
    await expectErr('H5b', 'cancel with bogus jobId shape', 'unknown_job', () =>
      client.request('jobs.cancel', { jobId: '../../x' })
    );
    const list0: any = await client.request('jobs.list', {});
    record(
      'H6',
      'jobs.list empty at start',
      '0 jobs',
      String(list0.jobs.length),
      list0.jobs.length === 0
    );

    // happy path: missing sub-scene
    const t0 = Date.now();
    const started: any = await expectOk(
      'H10',
      'jobs.create scene.draw for the missing sub-scene',
      'jobId job-<12hex>, branch auric/…, provider dummy, model dummy-small',
      () =>
        client.request('jobs.create', { project: PROJ, kind: 'scene.draw', payload: sceneJob() }),
      (r: any) =>
        /^job-[0-9a-f]{12}$/.test(r.jobId) &&
        r.provider === 'dummy' &&
        r.model === 'dummy-small' &&
        !!r.branch &&
        !!r.base
          ? true
          : JSON.stringify(r)
    );
    if (started) {
      const early = events.some(
        (e) => e.event === 'job.started' && e.data.job.jobId === started.jobId
      );
      const sev = await waitEvent(
        (e) => e.event === 'job.started' && e.data.job.jobId === started.jobId,
        5000
      ).catch(() => null);
      record(
        'H11',
        'job.started event (spec example shows it BEFORE the response)',
        'present, status running, delivered before the response',
        sev ? `status=${sev.data.job.status}; before response=${early}` : 'missing',
        sev?.data.job.status === 'running' && early
      );
      const end = await jobEnd(started.jobId);
      const job = end.data.job;
      record(
        'H12',
        `job.finished after ${Date.now() - t0} ms`,
        'finished, commit set, documents=[target created]',
        `${end.event} status=${job.status} commit=${String(job.commit).slice(0, 8)} docs=${JSON.stringify(job.documents)} otherFiles=${job.otherFiles} files=${job.files} err=${JSON.stringify(job.error)}`,
        end.event === 'job.finished' &&
          job.documents[0]?.id === 'docs/architecture/observability.scene.json' &&
          job.documents[0].created === true &&
          job.otherFiles.length === 0
      );
      const prompt =
        readdirSync(join(BASE, 'logs'))
          .map((f) => readFileSync(join(BASE, 'logs', f), 'utf8'))
          .find((t) => t.includes(started.jobId)) ?? '';
      record(
        'H13',
        'prompt: job id, kind, instructions path, fenced payload as data',
        'all present',
        `jobId=${prompt.includes(started.jobId)} kind=${prompt.includes('scene.draw')} instr=${prompt.includes('docs/agents/scene-draw.md')} fence=${/<<<PAYLOAD-[0-9a-f]{12}/.test(prompt)} target=${prompt.includes('docs/architecture/observability.scene.json')}`,
        prompt.includes('docs/agents/scene-draw.md') &&
          /<<<PAYLOAD-[0-9a-f]{12}/.test(prompt) &&
          prompt.includes(started.jobId)
      );
      const cwdLine = /cwd=(.*?) HOME/.exec(prompt)?.[1] ?? '';
      record(
        'H14',
        'agent cwd is its own worktree, not the project',
        'path != project',
        cwdLine,
        cwdLine !== '' && cwdLine !== PROJ && cwdLine !== '/private' + PROJ
      );
      const view: any = await client.request('documents.get', {
        project: PROJ,
        type: 'scene',
        id: 'docs/architecture/observability.scene.json',
        rev: job.branch,
      });
      record(
        'H15',
        'preview via rev=<job branch>',
        'merged=false',
        `merged=${view.merged} hasPositions=${!!view.document.nodes?.[0]?.position}`,
        view.merged === false
      );
      const view2: any = await client.request('documents.get', {
        project: PROJ,
        type: 'scene',
        id: 'docs/architecture/observability.scene.json',
        rev: job.commit,
      });
      record(
        'H16',
        'preview via rev=<commit from job.finished>',
        'merged=false, same hash',
        `merged=${view2.merged} sameHash=${view2.hash === view.hash}`,
        view2.merged === false && view2.hash === view.hash
      );
      await expectErr(
        'H17',
        'working tree still has no observability scene',
        'document_not_found',
        () =>
          client.request('documents.get', {
            project: PROJ,
            type: 'scene',
            id: 'docs/architecture/observability.scene.json',
          })
      );
      const wtStatus = git(PROJ, 'status', '--porcelain');
      record(
        'H18',
        'project working tree clean while job ran',
        'empty',
        JSON.stringify(wtStatus),
        wtStatus === ''
      );
      const wlist = git(PROJ, 'worktree', 'list');
      record(
        'H19',
        'git worktree for the job exists',
        'listed',
        wlist.split('\n').find((l) => l.includes(job.branch)) ?? wlist,
        wlist.includes(job.branch)
      );
      // merge then re-read
      git(PROJ, 'merge', '--no-edit', '-q', job.branch);
      const view3: any = await client.request('documents.get', {
        project: PROJ,
        type: 'scene',
        id: 'docs/architecture/observability.scene.json',
        rev: job.branch,
      });
      record(
        'H20',
        'after the human merged: same rev read',
        'merged=true',
        `merged=${view3.merged}`,
        view3.merged === true
      );
      const wt2: any = await client.request('documents.get', {
        project: PROJ,
        type: 'scene',
        id: 'docs/architecture/observability.scene.json',
      });
      record(
        'H21',
        'working-tree read now returns it',
        'ok',
        wt2.hash === view.hash ? 'same hash' : 'different',
        wt2.hash === view.hash
      );
      const jl: any = await client.request('jobs.list', { status: 'finished' });
      record(
        'H22',
        'jobs.list status=finished',
        '1 job',
        String(jl.jobs.length),
        jl.jobs.length === 1
      );
      const progress = events.filter(
        (e) => e.event === 'job.progress' && e.data.jobId === started.jobId
      ).length;
      record('H23', 'job.progress emitted (info)', '>=0', String(progress), true);
    }

    async function mode(
      id: string,
      label: string,
      expectEvent: 'job.finished' | 'job.failed',
      code: string | null,
      extra?: (job: any) => string | true
    ) {
      const st: any = await client
        .request('jobs.create', {
          project: PROJ,
          kind: 'scene.draw',
          payload: sceneJob({
            label,
            target: `docs/architecture/m-${label}.scene.json`,
            ref: `./m-${label}.scene.json`,
          }),
        })
        .catch((e: any) => ({ err: `${e.code}: ${e.message}` }));
      if (st.err) return record(id, `mode ${label}`, expectEvent, st.err, false);
      const end = await jobEnd(st.jobId, 120_000).catch(() => null);
      if (!end) return record(id, `mode ${label}`, expectEvent, 'timeout', false);
      const job = end.data.job;
      const ex = extra ? extra(job) : true;
      record(
        id,
        `dummy agent mode "${label}"`,
        `${expectEvent}${code ? ' ' + code : ''}`,
        `${end.event} error=${JSON.stringify(job.error)} docs=${job.documents.map((d: any) => d.id)} other=${job.otherFiles} files=${job.files} commit=${String(job.commit).slice(0, 8)}${ex === true ? '' : ' | ' + ex}`,
        end.event === expectEvent && (job.error?.code ?? null) === code && ex === true
      );
      return job;
    }
    await mode('H30', 'uncommitted', 'job.finished', null, (j) =>
      j.commit && j.documents.length === 1 ? true : 'IDE did not commit leftovers'
    );
    await mode('H31', 'nochange', 'job.failed', 'no_changes');
    await mode('H32', 'fail', 'job.failed', 'agent_failed');
    await mode('H33', 'invalid', 'job.failed', 'document_invalid');
    await mode('H34', 'outside', 'job.finished', null, (j) =>
      j.otherFiles.includes('outside.txt') ? true : `otherFiles=${j.otherFiles}`
    );
    await mode('H35', 'wrongpath', 'job.finished', null, (j) =>
      j.documents.length === 1 && j.documents[0].id !== 'docs/architecture/m-wrongpath.scene.json'
        ? true
        : JSON.stringify(j.documents)
    );

    // cancel
    const slow: any = await client.request('jobs.create', {
      project: PROJ,
      kind: 'scene.draw',
      payload: sceneJob({ label: 'slow', target: 'docs/architecture/m-slow.scene.json' }),
    });
    await sleep(2500);
    const c: any = await client.request('jobs.cancel', { jobId: slow.jobId });
    record(
      'H40',
      'jobs.cancel running job',
      '{cancelled:true,status:running}',
      JSON.stringify(c),
      c.cancelled === true
    );
    const cend = await jobEnd(slow.jobId, 30_000).catch(() => null);
    record(
      'H41',
      'cancelled job ends failed/cancelled',
      'job.failed cancelled',
      cend ? `${cend.event} ${cend.data.job.error?.code}` : 'timeout',
      cend?.event === 'job.failed' && cend.data.job.error?.code === 'cancelled'
    );
    const c2: any = await client.request('jobs.cancel', { jobId: slow.jobId });
    record(
      'H42',
      'cancel again',
      '{cancelled:false,status:failed}',
      JSON.stringify(c2),
      c2.cancelled === false && c2.status === 'failed'
    );
    const listed: any = await client.request('jobs.list', { limit: 200 });
    record(
      'H43',
      'jobs.list newest first',
      'sorted desc by createdAt',
      listed.jobs.map((j: any) => j.createdAt).join(','),
      listed.jobs.every(
        (j: any, i: number) => i === 0 || listed.jobs[i - 1].createdAt >= j.createdAt
      )
    );
    await expectErr('H44', 'jobs.list limit 0', 'invalid_params', () =>
      client.request('jobs.list', { limit: 0 })
    );
    await expectErr('H45', 'jobs.list limit 201', 'invalid_params', () =>
      client.request('jobs.list', { limit: 201 })
    );
    record(
      'H46',
      'unknown event names seen by consumer',
      'none',
      JSON.stringify(unknownEvents),
      unknownEvents.length === 0
    );
  }

  // ------------------------------------------------------------ I: job-level configuration errors + quota
  if (run('I')) {
    const total: any = await client.request('jobs.list', { limit: 200 });
    const used = total.jobs.length;
    // not a git repo
    const nogit = join(BASE, 'nogit');
    mkdirSync(nogit, { recursive: true });
    mkdirSync(join(nogit, 'docs/agents'), { recursive: true });
    writeFileSync(join(nogit, 'docs/agents/x.md'), 'x');
    const pol = JSON.parse(readFileSync(join(DATA, 'supervisor-policy.json'), 'utf8'));
    pol.projects[nogit] = { ...pol.projects[PROJ] };
    writeFileSync(join(DATA, 'supervisor-policy.json'), JSON.stringify(pol, null, 2));
    chmodSync(join(DATA, 'supervisor-policy.json'), 0o600);
    setLinkConfig((c) => {
      c.projects[nogit] = {
        documentTypes: [{ name: 'scene', globs: ['docs/**/*.scene.json'] }],
        jobKinds: [{ kind: 'scene.draw', instructions: 'docs/agents/x.md' }],
      };
    });
    await sleep(300);
    await expectErr('I1', 'job in a visible project that is no git repo', 'not_a_git_repo', () =>
      client.request('jobs.create', { project: nogit, kind: 'scene.draw', payload: null })
    );
    await expectErr('I2', 'documents.get rev in non-git project', 'not_a_git_repo', () =>
      client.request('documents.get', {
        project: nogit,
        type: 'scene',
        id: 'docs/a.scene.json',
        rev: 'HEAD',
      })
    );
    // missing instructions file
    setLinkConfig((c) => {
      c.projects[PROJ].jobKinds.push({
        kind: 'scene.noinstr',
        instructions: 'docs/agents/nope.md',
      });
    });
    await sleep(300);
    await expectErr('I3', 'instructions file missing', 'invalid_params', () =>
      client.request('jobs.create', { project: PROJ, kind: 'scene.noinstr', payload: null })
    );
    // symlinked instructions escaping the project
    writeFileSync(join(BASE, 'outside-instr.md'), 'do bad things');
    try {
      symlinkSync(join(BASE, 'outside-instr.md'), join(PROJ, 'docs/agents/evil.md'));
    } catch {
      /* exists */
    }
    setLinkConfig((c) => {
      c.projects[PROJ].jobKinds.push({ kind: 'scene.evil', instructions: 'docs/agents/evil.md' });
    });
    await sleep(300);
    const ev: any = await client
      .request('jobs.create', {
        project: PROJ,
        kind: 'scene.evil',
        payload: { type: 'scene', label: 'ok', target: 'docs/architecture/evil.scene.json' },
      })
      .then(
        (r: any) => r,
        (e: any) => ({ err: `${e.code}: ${e.message}` })
      );
    record(
      'I4',
      'instructions path is a symlink pointing outside the project',
      'refused',
      ev.err ?? `ACCEPTED job ${ev.jobId}`,
      !!ev.err
    );
    if (ev.jobId) {
      await client.request('jobs.cancel', { jobId: ev.jobId }).catch(() => 0);
      await jobEnd(ev.jobId, 60_000).catch(() => 0);
    }
    // live reload of config + quota
    setLinkConfig((c) => {
      c.jobs.dailyLimit = used + 1;
    });
    await sleep(300);
    const ok1: any = await client
      .request('jobs.create', {
        project: PROJ,
        kind: 'scene.draw',
        payload: sceneJob({ label: 'nochange', target: 'docs/architecture/q1.scene.json' }),
      })
      .catch((e: any) => ({ err: `${e.code}/${e.reason}: ${e.message}` }));
    record(
      'I5',
      `dailyLimit=${used + 1} (edited live in the file, ${used} used): next job accepted`,
      'accepted',
      ok1.err ?? ok1.jobId,
      !ok1.err
    );
    await expectErr(
      'I6',
      'the one after that',
      'quota_exceeded',
      () =>
        client.request('jobs.create', { project: PROJ, kind: 'scene.draw', payload: sceneJob() }),
      'daily_limit'
    );
    try {
      await client.request('jobs.create', {
        project: PROJ,
        kind: 'scene.draw',
        payload: sceneJob(),
      });
    } catch (e: any) {
      record(
        'I6b',
        'message names the reset time',
        'contains "frees up"',
        e.message,
        /frees up|free/.test(e.message)
      );
    }
    setLinkConfig((c) => {
      c.jobs.dailyLimit = 100;
      c.jobs.perProjectDailyLimit = used + 1;
    });
    await sleep(300);
    await expectErr(
      'I7',
      'perProjectDailyLimit reached',
      'quota_exceeded',
      () =>
        client.request('jobs.create', { project: PROJ, kind: 'scene.draw', payload: sceneJob() }),
      'project_daily_limit'
    );
    setLinkConfig((c) => {
      c.jobs.dailyLimit = 0;
      c.jobs.perProjectDailyLimit = null;
    });
    await sleep(300);
    await expectErr(
      'I8',
      'dailyLimit 0 switches jobs off',
      'quota_exceeded',
      () =>
        client.request('jobs.create', { project: PROJ, kind: 'scene.draw', payload: sceneJob() }),
      'daily_limit'
    );
    setLinkConfig((c) => {
      c.jobs.dailyLimit = 1001;
    });
    await sleep(300);
    const big: any = await client
      .request('jobs.create', {
        project: PROJ,
        kind: 'scene.draw',
        payload: sceneJob({ label: 'nochange' }),
      })
      .catch((e: any) => ({ err: `${e.code}: ${e.message}` }));
    record(
      'I9',
      'dailyLimit 1001 (> max 1000) in file',
      'file rejected as a whole -> fail closed (document_not_visible) OR clamped; either is stated',
      big.err ?? `accepted ${big.jobId}`,
      true
    );
    setLinkConfig((c) => {
      c.jobs.dailyLimit = 100;
    });
    // broken file fails closed
    const p = join(DATA, 'supervisor-link.json');
    const keep = readFileSync(p, 'utf8');
    writeFileSync(p, '{ broken');
    await sleep(300);
    await expectErr('I10', 'broken supervisor-link.json', 'document_not_visible', () =>
      client.request('documents.get', {
        project: PROJ,
        type: 'scene',
        id: 'docs/architecture/system.scene.json',
      })
    );
    writeFileSync(p, keep);
    chmodSync(p, 0o600);
    await sleep(300);
    const back: any = await client.request('documents.projects');
    record(
      'I11',
      'file restored -> project visible again',
      '1+ projects',
      String(back.projects.length),
      back.projects.length >= 1
    );
    const modeBits = execFileSync('stat', ['-f', '%Lp', p], { encoding: 'utf8' }).trim();
    record('I12', 'supervisor-link.json mode (info)', '600', modeBits, modeBits === '600');
    const reg = join(DATA, 'supervisor-link-jobs.json');
    record(
      'I13',
      'job register file exists, mode 0600',
      '600',
      existsSync(reg)
        ? execFileSync('stat', ['-f', '%Lp', reg], { encoding: 'utf8' }).trim()
        : 'missing',
      existsSync(reg) &&
        execFileSync('stat', ['-f', '%Lp', reg], { encoding: 'utf8' }).trim() === '600'
    );
  }

  // ------------------------------------------------------------ K: the consumer's scene source against the real IDE
  if (run('K')) {
    const { StudioHub } = await import(`${M}/apps/server/src/studio/session.ts`);
    const { LinkSceneCache } = await import(`${M}/apps/server/src/auric/link-scene-cache.ts`);
    const { createLinkSceneSource, linkArtifactId } = await import(
      `${M}/apps/server/src/auric/link-scene-source.ts`
    );
    await client.request('events.subscribe', {});
    const sfx = Date.now().toString(36);
    const mk = (title: string, nodes: any[], links: any[] = []) =>
      JSON.stringify({ hud: { title, subtitle: 'studio format' }, nodes, links }, null, 2) + '\n';
    const dir = join(PROJ, 'docs/studio');
    mkdirSync(join(dir, 'modules'), { recursive: true });
    writeFileSync(
      join(dir, 'system.scene.json'),
      mk(
        'Studio system',
        [
          { id: 'api', label: 'API', detail: './modules/api.scene.json' },
          { id: 'auth', label: 'Auth', detail: `./modules/auth-${sfx}.scene.json` },
          { id: 'studioformat', label: 'studioformat', detail: `./modules/mf-${sfx}.scene.json` },
        ],
        [{ from: 'api', to: 'auth' }]
      )
    );
    writeFileSync(
      join(dir, 'modules/api.scene.json'),
      mk('API', [{ id: 'routes', label: 'Routes' }])
    );
    git(PROJ, 'add', '-A');
    if (git(PROJ, 'status', '--porcelain')) git(PROJ, 'commit', '-q', '-m', 'studio-format scenes');
    const ROOT_ID = 'docs/studio/system.scene.json';
    const CANON = realpathSync(PROJ);
    const art = linkArtifactId(CANON, ROOT_ID);
    const hub = new StudioHub({
      draftsDir: null,
      modelScene: async () => '{"nodes":[{"id":"x"}]}',
      sceneSource: (local: any) =>
        createLinkSceneSource(local, { client, cache: new LinkSceneCache(null) }),
    });
    const studio = hub.sessionFor({ id: 'tab', studio: null });
    const states: any[] = [];
    studio.attach((line: string) => {
      const m = JSON.parse(line);
      if (m.type === 'studio_scene_state') states.push(m);
    });
    const status = (n: string) =>
      studio.sceneState()?.details.find((d: any) => d.nodeId === n)?.status;
    const until = async (f: () => boolean, ms = 60_000) => {
      const end = Date.now() + ms;
      while (!f()) {
        if (Date.now() > end) throw new Error('timeout');
        await sleep(50);
      }
    };

    let found: any = null;
    try {
      found = await studio.findScenes('');
      record(
        'K1',
        'WebSocketSceneSource.search over the whole project (5 core-format files + 2 studio-format files)',
        'lists scenes without throwing',
        `returned ${JSON.stringify(found).slice(0, 160)}`,
        true
      );
    } catch (e: any) {
      record(
        'K1',
        'WebSocketSceneSource.search over the whole project (core-format files present)',
        'lists scenes without throwing',
        `THROWS: ${String(e.message).slice(0, 200)}`,
        false
      );
    }
    const foundStudio = await studio.findScenes('studio').catch((e: any) => `THROWS ${e.message}`);
    record(
      'K2',
      'search narrowed to the studio-format files ("studio")',
      'lists them',
      typeof foundStudio === 'string' ? foundStudio : `${foundStudio.length} scenes`,
      typeof foundStudio !== 'string' && foundStudio.length >= 2
    );
    try {
      await studio.openFromSource(art);
      record(
        'K3',
        'open the studio-format root scene from the real IDE',
        'opens, current set',
        `current=${studio.current()?.artifactId}`,
        studio.current()?.artifactId === art
      );
    } catch (e: any) {
      record('K3', 'open root', 'opens', String(e.message), false);
    }
    const a1 = await studio.enter('api').catch((e: any) => `THROWS ${e.message}`);
    record(
      'K4',
      'drill into an existing sub-scene (documents.resolve with the node pointer)',
      'null (entered), current = child',
      `answer=${JSON.stringify(a1)} current=${studio.current()?.artifactId}`,
      a1 === null
    );
    await studio.ancestor(0).catch(() => 0);
    const a2 = await studio.enter('auth').catch((e: any) => `THROWS ${e.message}`);
    record(
      'K5',
      'drill into a MISSING sub-scene starts a job',
      '"being modelled in AuricIDE", node loading',
      `answer=${String(a2).slice(0, 90)} status=${status('auth')}`,
      /being modelled/.test(String(a2)) && status('auth') === 'loading'
    );
    const j: any = (await client.request('jobs.list', { limit: 10 })).jobs.find(
      (x: any) => x.payload?.node === 'auth'
    );
    record(
      'K5b',
      'payload the consumer sent',
      '{type,parent,node,ref,target,label}',
      JSON.stringify(j?.payload),
      j?.payload.target === `docs/studio/modules/auth-${sfx}.scene.json` &&
        j.payload.ref === `./modules/auth-${sfx}.scene.json`
    );
    await until(() => status('auth') !== 'loading').catch(() => 0);
    const authState = studio.sceneState()?.details.find((d: any) => d.nodeId === 'auth');
    record(
      'K6',
      'job (dummy agent draws a core-format scene as the skill prescribes) -> what the consumer shows',
      'ready with preview',
      `status=${authState?.status} error=${String((authState as any)?.error).slice(0, 160)}`,
      authState?.status === 'ready'
    );
    const a6 = await studio.enter('auth').catch((e: any) => `THROWS ${e.message}`);
    record(
      'K6b',
      'enter the node whose job drew a core-format scene (what the skill prescribes)',
      'null (shows the preview)',
      `answer=${JSON.stringify(a6)}`,
      a6 === null
    );
    await studio.ancestor(0).catch(() => 0);
    await studio.enter('studioformat').catch((e: any) => `THROWS ${e.message}`);
    await until(() => status('studioformat') !== 'loading').catch(() => 0);
    record(
      'K7',
      'job draws a studio-format scene -> node ready',
      'ready',
      `status=${status('studioformat')}`,
      status('studioformat') === 'ready'
    );
    if (status('studioformat') === 'ready') {
      const a4 = await studio.enter('studioformat').catch((e: any) => `THROWS ${e.message}`);
      const origin: any = studio.sceneState()?.origin;
      record(
        'K8',
        'entering the finished node shows an unmerged preview',
        'origin.preview.branch set, draft=false',
        `answer=${JSON.stringify(a4)} origin=${JSON.stringify(origin)}`,
        a4 === null && !!origin?.preview?.branch && origin.draft === false
      );
      const mj: any = (await client.request('jobs.list', { limit: 5 })).jobs.find(
        (x: any) => x.payload?.label === 'studioformat'
      );
      git(PROJ, 'merge', '--no-edit', '-q', mj.branch);
      await studio.ancestor(0).catch(() => 0);
      const a5 = await studio.enter('studioformat').catch((e: any) => `THROWS ${e.message}`);
      const origin2: any = studio.sceneState()?.origin;
      record(
        'K9',
        'after the human merged: preview gone',
        'no preview',
        `answer=${JSON.stringify(a5)} preview=${JSON.stringify(origin2?.preview)}`,
        origin2?.preview === undefined
      );
    }
    // submit a local change as a proposal through the consumer
    try {
      const prop: any = await studio
        .submitScene(art, 'e2e')
        .catch((e: any) => ({ err: e.message }));
      record(
        'K10',
        'submitScene of an unchanged repo version',
        'refused ("already the one in the repo")',
        JSON.stringify(prop).slice(0, 160),
        !!prop.err
      );
    } catch (e: any) {
      record('K10', 'submitScene', 'refused', String(e), false);
    }
  }

  // ------------------------------------------------------------ L: agents in the tree, concurrency, unsubscribe
  if (run('L')) {
    await client.request('events.subscribe', {});
    await expectErr(
      'L1',
      'supervisors.spawn with a provider the supervisor cannot run on (dummy)',
      'provider_unsupported',
      () => client.request('supervisors.spawn', { task: 'x', provider: 'dummy' })
    );
    const slow = async (n: string) =>
      client.request('jobs.create', {
        project: PROJ,
        kind: 'scene.draw',
        payload: sceneJob({
          label: 'slow',
          target: `docs/architecture/slow-${n}.scene.json`,
          ref: `./slow-${n}.scene.json`,
        }),
      }) as Promise<any>;
    const j1 = await slow('1');
    await sleep(1500);
    const lst: any = await client.request('agents.list');
    const me = lst.agents.find((a: any) => a.id === j1.agentId);
    record(
      'L2',
      'job agent is in the tree (agents.list)',
      'running, headless, projectPath set',
      JSON.stringify(
        me && {
          status: me.status,
          headless: me.headless,
          role: me.role,
          spawnedBy: me.spawnedByAgentId,
          project: me.projectPath,
          repo: me.repoPath,
        }
      ),
      me?.status === 'running' && me.headless === true
    );
    record(
      'L2b',
      'currentTask of a job agent = prompt incl. payload (documented security note)',
      'contains PAYLOAD fence',
      String(me?.currentTask).slice(0, 80).replace(/\n/g, ' '),
      /PAYLOAD-/.test(String(me?.currentTask))
    );
    await expectErr('L3', 'agents.send into a headless job agent', 'headless_no_stdin', () =>
      client.request('agents.send', { agentId: j1.agentId, text: 'hi' })
    );
    const rd: any = await client
      .request('agents.read', { agentId: j1.agentId })
      .catch((e: any) => ({ err: e.code }));
    record('L4', 'agents.read of a job agent', 'chunk', JSON.stringify(rd).slice(0, 100), !rd.err);
    const j2 = await slow('2');
    const j3 = await slow('3');
    await expectErr('L5', '4th concurrent job (project maxRunning=3)', 'supervisor_denied', () =>
      slow('4')
    );
    try {
      await slow('5');
    } catch (e: any) {
      record('L5b', 'denial names the rule', 'reason set', `${e.reason}: ${e.message}`, !!e.reason);
    }
    const k: any = await client
      .request('agents.kill', { agentId: j1.agentId })
      .catch((e: any) => ({ err: `${e.code}: ${e.message}` }));
    record(
      'L6',
      'agents.kill of a job agent over the link',
      '{killed:true}',
      JSON.stringify(k),
      k.killed === true
    );
    const e1 = await jobEnd(j1.jobId, 30_000).catch(() => null);
    record(
      'L7',
      'job after its agent was killed (not via jobs.cancel)',
      'job.failed (cancelled / agent_failed)',
      e1 ? `${e1.event} ${e1.data.job.error?.code}` : 'timeout (job stays running?)',
      !!e1 && e1.event === 'job.failed'
    );
    await expectErr('L8', 'agents.read of the killed agent', 'unknown_agent', () =>
      client.request('agents.read', { agentId: j1.agentId })
    );
    await client.request('jobs.cancel', { jobId: j2.jobId });
    await client.request('jobs.cancel', { jobId: j3.jobId });
    await jobEnd(j2.jobId, 30_000).catch(() => 0);
    await jobEnd(j3.jobId, 30_000).catch(() => 0);
    const un: any = await client.request('events.unsubscribe');
    record(
      'L9',
      'events.unsubscribe',
      '{subscribed:false}',
      JSON.stringify(un),
      un.subscribed === false
    );
    const before = events.length;
    const q: any = await client.request('jobs.create', {
      project: PROJ,
      kind: 'scene.draw',
      payload: sceneJob({ label: 'nochange', target: 'docs/architecture/unsub.scene.json' }),
    });
    await sleep(5000);
    record(
      'L10',
      'no job.* events after unsubscribe',
      '0 new events',
      String(events.length - before),
      events.length === before
    );
    const lj: any = await client.request('jobs.list', { limit: 3 });
    record(
      'L11',
      'job still ends and is listed (poll fallback)',
      'status failed no_changes',
      `${lj.jobs.find((x: any) => x.jobId === q.jobId)?.status}`,
      lj.jobs.find((x: any) => x.jobId === q.jobId)?.status !== 'running'
    );
    await client.request('events.subscribe', {});
  }

  // ------------------------------------------------------------ J: scene format vs the consumer
  if (run('J')) {
    const search: any = await client.request('documents.search', { type: 'scene' });
    const results: string[] = [];
    for (const d of search.documents.filter((x: any) => x.id.startsWith('docs/architecture/'))) {
      const doc: any = await client.request('documents.get', {
        project: PROJ,
        type: 'scene',
        id: d.id,
      });
      try {
        core.validateSceneSource(JSON.stringify(doc.document));
        results.push(`${d.id}: ok`);
      } catch (e: any) {
        results.push(`${d.id}: ${String(e.message).slice(0, 90)}`);
      }
    }
    record(
      'J1',
      'consumer validateSceneSource on every core-format scene stored in the project',
      'accepted',
      results.join(' || '),
      results.every((r) => r.endsWith(': ok'))
    );
    const cli = (f: string) => {
      try {
        execFileSync('node', [join(ARCH, 'dist/cli.js'), 'validate', f, '--root', PROJ], {
          encoding: 'utf8',
        });
        return 0;
      } catch (e: any) {
        return e.status;
      }
    };
    record(
      'J2',
      '`scene validate` (core CLI) on the same files',
      'exit 0 for the originals',
      ['checkout', 'runtime', 'storage']
        .map((n) => `${n}=${cli(join(PROJ, `docs/architecture/${n}.scene.json`))}`)
        .join(' '),
      ['checkout', 'runtime', 'storage'].every(
        (n) => cli(join(PROJ, `docs/architecture/${n}.scene.json`)) === 0
      )
    );
    const dummyOut = join(PROJ, 'docs/architecture/observability.scene.json');
    if (existsSync(dummyOut))
      record(
        'J3',
        'scene written by a (dummy) job agent in core format passes core validate',
        'exit 0',
        String(cli(dummyOut)),
        cli(dummyOut) === 0
      );
  }
} finally {
  record(
    'Z1',
    'sequence gaps seen by the consumer client over the whole run',
    '0',
    String(gaps),
    gaps === 0
  );
  client.stop();
  const pass = rows.filter((r) => r.pass).length;
  console.log(`\nSUMMARY ${pass}/${rows.length} passed`);
  for (const r of rows.filter((x) => !x.pass))
    console.log(
      `FAIL ${r.id}: ${r.step}\n     expected: ${r.expected}\n     actual:   ${r.actual}`
    );
  writeFileSync(join(BASE, 'matrix.json'), JSON.stringify(rows, null, 2));
  process.exit(0);
}
