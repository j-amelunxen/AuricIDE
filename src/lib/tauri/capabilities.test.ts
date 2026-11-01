import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Capability {
  windows: string[];
  permissions: (string | { identifier: string })[];
}

const CAPABILITIES_DIR = join(__dirname, '../../../src-tauri/capabilities');

function grantedPermissions(window: string): string[] {
  return readdirSync(CAPABILITIES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(join(CAPABILITIES_DIR, file), 'utf8')) as Capability)
    .filter((capability) => capability.windows.includes(window))
    .flatMap((capability) =>
      capability.permissions.map((p) => (typeof p === 'string' ? p : p.identifier))
    );
}

describe('window capabilities', () => {
  // Both windows hide the native title bar (`titleBarStyle: Overlay` for `main`) and mark their
  // header with `data-tauri-drag-region`. That attribute only moves the window when the window
  // may call `start_dragging`; `core:default` does not include it, so without the grant the
  // header ignores the drag while the traffic lights still work.
  it.each(['main', 'agents'])('lets the %s window be dragged by its header', (window) => {
    expect(grantedPermissions(window)).toContain('core:window:allow-start-dragging');
  });
});
