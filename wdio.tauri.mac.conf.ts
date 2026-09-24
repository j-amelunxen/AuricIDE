import { resolve } from 'node:path';

const appBinaryPath = resolve(process.cwd(), 'src-tauri/target/debug/auric-ide');
const embeddedPort = Number.parseInt(process.env.TAURI_WEBDRIVER_PORT ?? '', 10);

if (!Number.isInteger(embeddedPort) || embeddedPort < 1 || embeddedPort > 65_535) {
  throw new Error('TAURI_WEBDRIVER_PORT must be a valid per-run loopback port.');
}

export const config = {
  runner: 'local',
  specs: ['./e2e/tauri/**/*.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: appBinaryPath,
      },
    },
  ],
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath,
        driverProvider: 'embedded',
        embeddedPort,
        statusPollTimeout: 10_000,
      },
    ],
  ],
  framework: 'mocha',
  mochaOpts: {
    timeout: 60_000,
    retries: 0,
    ui: 'bdd',
  },
  waitforTimeout: 10_000,
  connectionRetryCount: 0,
  connectionRetryTimeout: 90_000,
  logLevel: 'warn',
  outputDir: process.env.VFY_TAURI_ARTIFACT_DIR,
};
