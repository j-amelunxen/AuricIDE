import { execFile as execFileCallback } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const EXPECTED_REJECTION = 'e2e-webdriver feature must never be linked into a release artifact';

export async function assertE2eReleaseRejected({ execute = execFile } = {}) {
  try {
    await execute(
      'cargo',
      [
        'check',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--release',
        '--features',
        'e2e-webdriver',
      ],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 }
    );
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    if (stderr.includes(EXPECTED_REJECTION)) return;
    throw error;
  }

  throw new Error('Security boundary failed: a release artifact accepted e2e-webdriver.');
}

async function main() {
  await assertE2eReleaseRejected();
  process.stdout.write('Release build correctly rejects the e2e-webdriver feature.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`e2e-release-boundary: ${error.message}\n`);
    process.exitCode = 1;
  });
}
