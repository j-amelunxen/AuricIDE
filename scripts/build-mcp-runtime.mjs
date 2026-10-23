import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'src-tauri', 'resources', 'auric-mcp');
const require = createRequire(import.meta.url);
const bun = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'bun.exe' : 'bun');
if (!existsSync(bun)) {
  throw new Error('Pinned Bun bundler is missing; run pnpm install before building AuricIDE');
}

rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'node_modules'), { recursive: true });

const bundle = spawnSync(
  bun,
  [
    'build',
    'src/mcp/server.ts',
    '--target=node',
    '--outfile',
    join(output, 'server.mjs'),
    '--external',
    'better-sqlite3',
    '--external',
    '@valibot/to-json-schema',
    '--external',
    'sury',
    '--external',
    'effect',
  ],
  { cwd: root, stdio: 'inherit' }
);
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

// For agent CLIs that read MCP servers only from one global config: that entry
// points at bridge.mjs, which becomes the server of the config the IDE bound
// the agent to (src/mcp/configBridge.ts). Node built-ins only, nothing external.
const bridge = spawnSync(
  bun,
  ['build', 'src/mcp/configBridge.ts', '--target=node', '--outfile', join(output, 'bridge.mjs')],
  { cwd: root, stdio: 'inherit' }
);
if (bridge.status !== 0) process.exit(bridge.status ?? 1);

const sqlitePackage = require.resolve('better-sqlite3/package.json');
const sqliteRequire = createRequire(sqlitePackage);
for (const dependency of ['better-sqlite3', 'bindings', 'file-uri-to-path']) {
  const source = dirname(
    dependency === 'better-sqlite3'
      ? sqlitePackage
      : sqliteRequire.resolve(`${dependency}/package.json`)
  );
  cpSync(source, join(output, 'node_modules', dependency), { recursive: true });
}

// `require('better-sqlite3')` succeeds on a mismatched Node; opening a
// database is what loads the native addon. Fail here rather than write an
// ABI the copied .node cannot actually serve.
const bundledSqlite = createRequire(join(output, 'node_modules/better-sqlite3/package.json'));
try {
  const Database = bundledSqlite('better-sqlite3');
  const db = new Database(':memory:');
  db.close();
} catch (error) {
  const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
  throw new Error(
    `better-sqlite3 in the MCP bundle cannot open a database in Node ${process.version} (ABI ${process.versions.modules}). Run the bundle step with the Node this addon was compiled for. ${detail}`
  );
}

writeFileSync(
  join(output, 'manifest.json'),
  `${JSON.stringify({
      version: 1,
      entrypoint: 'server.mjs',
      // The native addon above was compiled for this Node; the IDE picks a
      // node with the same ABI (src-tauri/src/node_runtime.rs).
      nodeModuleVersion: process.versions.modules,
      nodeVersion: process.versions.node,
    }, null, 2)}\n`
);
