import { readFileSync } from 'node:fs';
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const cargoLock = readFileSync(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8');

const pairs = [
  ['@tauri-apps/api', 'tauri', 'minor'],
  ['@tauri-apps/plugin-dialog', 'tauri-plugin-dialog', 'exact'],
  ['@tauri-apps/plugin-fs', 'tauri-plugin-fs', 'exact'],
  ['@tauri-apps/plugin-notification', 'tauri-plugin-notification', 'exact'],
  ['@tauri-apps/plugin-opener', 'tauri-plugin-opener', 'exact'],
];

function cargoVersion(crate) {
  const escaped = crate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cargoLock.match(new RegExp(`name = "${escaped}"\\nversion = "([^"]+)"`));
  if (!match) throw new Error(`Rust crate ${crate} is missing from src-tauri/Cargo.lock`);
  return match[1];
}

function majorMinor(version) {
  return version.split('.').slice(0, 2).join('.');
}

const errors = [];

for (const [npmPackage, crate, compatibility] of pairs) {
  const declared = packageJson.dependencies?.[npmPackage];
  if (!/^\d+\.\d+\.\d+$/.test(declared ?? '')) {
    errors.push(`${npmPackage} must use an exact version in package.json (found ${declared ?? 'missing'})`);
    continue;
  }

  let installed;
  try {
    installed = JSON.parse(
      readFileSync(new URL(`../node_modules/${npmPackage}/package.json`, import.meta.url), 'utf8'),
    ).version;
  } catch {
    errors.push(`${npmPackage}@${declared} is not installed; run pnpm install`);
    continue;
  }

  const rust = cargoVersion(crate);
  if (installed !== declared) {
    errors.push(`${npmPackage}: declared ${declared}, installed ${installed}`);
  }
  const compatible = compatibility === 'exact' ? installed === rust : majorMinor(installed) === majorMinor(rust);
  if (!compatible) {
    errors.push(`${npmPackage}@${installed} is incompatible with ${crate}@${rust}`);
  }
}

const cliVersion = packageJson.devDependencies?.['@tauri-apps/cli'];
if (!/^\d+\.\d+\.\d+$/.test(cliVersion ?? '')) {
  errors.push(`@tauri-apps/cli must use an exact version in package.json (found ${cliVersion ?? 'missing'})`);
}

if (errors.length > 0) {
  console.error(`Tauri version check failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log('Tauri JavaScript and Rust package versions are aligned.');
