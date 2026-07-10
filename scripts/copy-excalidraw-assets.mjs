// Copies the @excalidraw/excalidraw runtime assets (fonts) into public/ so
// the read-only viewer works offline inside the Tauri app. The viewer sets
// window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/' to point here.
// Runs on postinstall; public/excalidraw-assets is gitignored.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts');
const target = join(root, 'public', 'excalidraw-assets', 'fonts');

if (!existsSync(source)) {
  console.warn('[copy-excalidraw-assets] source fonts not found — skipping');
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log('[copy-excalidraw-assets] fonts copied to public/excalidraw-assets/fonts');
