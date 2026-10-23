import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';

/**
 * How a Project Manager is shown, by its key (`docs/design-project-manager.md`,
 * "Settings → Supervisor → Project Managers"). Presentation is an application
 * preference; identity stays in Rust. A stored key the registry no longer has
 * is never read, so nothing here has to clean up after a removal.
 */
export interface ManagerPresentation {
  quickAccess: boolean;
  menuBar: boolean;
  /** An accelerator such as `Control+Alt+KeyR`, answered while another app is in front. */
  shortcut: string | null;
  /**
   * A launch option like the Supervisor tile's, never a grant. Null means the
   * supervisor default; a model the provider no longer offers is dropped at launch.
   */
  model: string | null;
}

/** What is stored: only what the human changed, so a new field never re-arms an old choice. */
type StoredPresentation = Partial<Omit<ManagerPresentation, 'shortcut' | 'model'>> & {
  shortcut?: string;
  model?: string;
};

const TEXT_FIELDS = ['shortcut', 'model'] as const;

export type ManagerPresentations = Record<string, StoredPresentation>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseStored(value: unknown): StoredPresentation {
  if (!isRecord(value)) return {};
  const stored: StoredPresentation = {};
  if (typeof value.quickAccess === 'boolean') stored.quickAccess = value.quickAccess;
  if (typeof value.menuBar === 'boolean') stored.menuBar = value.menuBar;
  for (const field of TEXT_FIELDS) {
    const text = value[field];
    if (typeof text === 'string' && text.trim() !== '') stored[field] = text.trim();
  }
  return stored;
}

export function parseManagerPresentations(raw: string | null): ManagerPresentations {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, parseStored(value)])
  );
}

export function readManagerPresentations(): ManagerPresentations {
  return parseManagerPresentations(readAppPref(APP_CONFIG_KEYS.supervisorManagers));
}

/** Shown in both places until the human says otherwise: a promoted manager should be easy to find. */
export function presentationOf(all: ManagerPresentations, key: string): ManagerPresentation {
  const stored = all[key] ?? {};
  return {
    quickAccess: stored.quickAccess ?? true,
    menuBar: stored.menuBar ?? true,
    shortcut: stored.shortcut ?? null,
    model: stored.model ?? null,
  };
}

export function updateManagerPresentation(key: string, patch: Partial<ManagerPresentation>): void {
  const all = readManagerPresentations();
  const { shortcut, model, ...flags } = patch;
  const next: StoredPresentation = { ...all[key], ...flags };
  for (const [field, value] of [
    ['shortcut', shortcut],
    ['model', model],
  ] as const) {
    if (value === null) delete next[field];
    else if (value !== undefined) next[field] = value;
  }
  writeAppPref(APP_CONFIG_KEYS.supervisorManagers, JSON.stringify({ ...all, [key]: next }));
}

/**
 * Drops the choices of keys the registry no longer holds. A removed manager's
 * key can be promoted again, and the new manager must not inherit the old
 * one's global shortcut. Archived managers are still in the registry.
 */
export function forgetRemovedManagers(registryKeys: readonly string[]): void {
  const all = readManagerPresentations();
  const kept = Object.entries(all).filter(([key]) => registryKeys.includes(key));
  if (kept.length === Object.keys(all).length) return;
  writeAppPref(APP_CONFIG_KEYS.supervisorManagers, JSON.stringify(Object.fromEntries(kept)));
}

const listed = (
  managers: SupervisorManager[],
  all: ManagerPresentations,
  surface: 'quickAccess' | 'menuBar'
) => managers.filter((m) => m.archivedAt === null && presentationOf(all, m.key)[surface]);

const hasRunFolder = (manager: SupervisorManager) => manager.runMissing !== true;

export const managersForQuickAccess = (managers: SupervisorManager[], all: ManagerPresentations) =>
  listed(managers, all, 'quickAccess');

export const managersForMenuBar = (managers: SupervisorManager[], all: ManagerPresentations) =>
  // An entry whose folder is gone could only fail when picked; the tile says "Folder missing".
  listed(managers, all, 'menuBar').filter(hasRunFolder);
