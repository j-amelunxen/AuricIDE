# e2e-link-stack

End-to-end run of the Supervisor Control API (`docs/design-supervisor-link.md`) against an
**isolated** AuricIDE: own fake HOME (so own app data dir and sockets), a dummy provider and a
throwaway git project. Nothing touches a running AuricIDE.

| File | Role |
| --- | --- |
| `setup.mjs` | Builds `<base>` (default `/tmp/e2e-link`): fake HOME, throwaway project with scene files, dummy provider, link + supervisor policy. Env: `ARCH_ROOT` (repo with `dist/cli.js` and `examples/` of the scene format), `E2E_BASE`, `E2E_SHORT`. |
| `dummy-agent.sh` | The "agent" of the dummy provider. The payload `label` picks the behaviour (`nochange`, `fail`, `slow`, `invalid`, `outside`, `wrongpath`, `uncommitted`, `studioformat`, anything else = draw a valid scene and commit). |
| `run.mts` | The test matrix. Imports a consumer's typed link client and scene source (read-only) by absolute path. Env: `CONSUMER_ROOT`, `ARCH_ROOT`, `E2E_SOCKET`. `--only A,B,...` runs sections. |

Steps:

1. Build the app without pnpm: `node scripts/build-mcp-runtime.mjs && node_modules/.bin/next build --webpack && node_modules/.bin/tauri build --debug --no-bundle -c '{"build":{"beforeBuildCommand":""}}'`.
2. `ARCH_ROOT=... node scripts/e2e-link-stack/setup.mjs`, then create `<base>/proj/.auric/project.db` (`openDatabase` from `src/mcp/db.ts`) and add `.auric/` to `<base>/proj/.git/info/exclude`.
3. Start `src-tauri/target/debug/auric-ide` with `HOME=/tmp/auric-iso CFFIXED_USER_HOME=/tmp/auric-iso`, cwd `<base>/run` (provider dir #1 is relative to the cwd).
4. Make a space-free alias of the app data dir (`ln -s "/tmp/auric-iso/Library/Application Support/com.auricide.ide" <base>/nospace`) and pass `E2E_SOCKET=<base>/nospace/supervisor-link.sock`: the `ws` package cannot dial a `ws+unix://` path that contains a space (check `A0` in the matrix).
5. `cd <consumer>/apps/server && CONSUMER_ROOT=... ARCH_ROOT=... node_modules/.bin/tsx <this dir>/run.mts`.
6. Stop only the PID you started and delete `<base>` and the `E2E_SHORT` symlink.

The run writes `<base>/matrix.json`. The sections depend on the state earlier ones leave, so run a
full pass on a fresh `setup.mjs`.
