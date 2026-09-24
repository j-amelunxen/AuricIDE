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

writeFileSync(
  join(output, 'manifest.json'),
  `${JSON.stringify({ version: 1, entrypoint: 'server.mjs' }, null, 2)}\n`
);
