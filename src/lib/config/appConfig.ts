/**
 * Settings that belong to the machine rather than to any one project.
 *
 * The dividing line: would the setting still be right if you opened a different
 * repository? A theme or editor toggle would — those live here. The spawn
 * defaults use one app-level envelope too, but key its entries by working
 * directory. A ticket-key pattern or a provider policy would not; those
 * live in `projectConfig`. Credentials are global too, but go through the Rust
 * store instead (`@/lib/tauri/appCredentials`), because a secret does not
 * belong in the localStorage mirror.
 *
 * Transport is that mirror: `localStorage` is copied into
 * `<app_data_dir>/webview-prefs.json` by `@/lib/storage/sharedPrefs`, which is
 * what makes one setting hold across the dev build and the installed bundle
 * despite their different WebKit stores and origins. Reading it synchronously
 * also matters — the theme is applied before the first paint.
 *
 * What this file adds is the schema the mirror never had: one list of the keys
 * that are application-wide, and one pair of accessors, so a change of storage
 * strategy is one edit rather than a search for every `localStorage` call.
 */

/**
 * Every application-wide key, including the ones whose values are still owned
 * by their own modules. Kept complete on purpose: this list is the answer to
 * "what does this app consider global", and a key missing from it is a key
 * nobody remembers to migrate.
 */
export const APP_CONFIG_KEYS = {
  theme: 'auric.theme',
  themeSnapshot: 'auric.theme.snapshot',
  accent: 'auric.accent',
  showAttribution: 'auric-show-attribution',
  statusBarClock: 'auric.status-bar.clock',
  skillSources: 'auric.skill-sources',
  auricSkills: 'auric.prompt-skills',
  spawnDefaults: 'auric.agent-spawn-defaults',
  customSlashCommands: 'auric-custom-slash-commands',
  recentCommands: 'auric-recent-commands',
  blueprintServerUrl: 'auric-blueprint-server-url',
  enableDeepNlp: 'auric.editor.deep-nlp',
  markdownLintEnabled: 'auric.editor.markdown-lint',
  mcpAutoStart: 'auric.mcp.auto-start',
  cliUsageLimits: 'auric.cli-usage-limits',
  agentTerminalFontSize: 'auric.agent-terminal-font-size',
  agentConsoleAutoOpen: 'auric.agent-console-auto-open',
  agentConsoleFeedHeight: 'auric.agent-console.feed-height',
  agentConsoleProjectsCollapsed: 'auric.agent-console.projects-collapsed',
  agentLogPersist: 'auric.agent-log.persist',
  agentLogRetentionDays: 'auric.agent-log.retention-days',
} as const;

/** Lets mounted UI react to a preference written in this same webview. */
export const APP_CONFIG_CHANGED_EVENT = 'auric:app-config-changed';

/** Every supported point size, shared by persistence validation and the UI. */
export const AGENT_TERMINAL_FONT_SIZES = [
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
] as const;

/**
 * Every offered retention span for the agent activity history, in days.
 * `0` means "no age limit", not "keep nothing" — a history that discards
 * everything is what switching the feature off is for.
 */
export const AGENT_LOG_RETENTION_DAYS = [2, 7, 30, 0] as const;

/**
 * The second bound on the stored history. Age alone cannot cap it: "no age
 * limit" is a span the user may pick, and a busy fleet writes events faster
 * than any span would trim them.
 */
export const AGENT_LOG_MAX_ROWS = 200_000;

/**
 * The settings this module owns outright. The others in `APP_CONFIG_KEYS` are
 * read and written by the modules that already model them (the theme catalog,
 * the skill-source rules, the spawn defaults); those go through `readAppPref` /
 * `writeAppPref` so every application-wide write still passes one door.
 *
 * Not here on purpose: `dangerouslyIgnorePermissions` and `autoAcceptEdits`.
 * Both stay session state. Persisting a switch that grants an agent free rein
 * and then quietly restoring it days later is the kind of setting a user does
 * not remember leaving on — so it starts off every launch, deliberately.
 */
export interface AppConfig {
  enableDeepNlp: boolean;
  markdownLintEnabled: boolean;
  mcpAutoStart: boolean;
  /**
   * Reads the agent CLIs' remaining quota and shows it in the status bar.
   *
   * Off by default because switching it on has an effect beyond the chip:
   * AuricIDE then passes `--settings` to every `claude` it starts, so the
   * status line can report the numbers. Codex is queried every 15 minutes
   * and when you refresh — that check costs credits. Also read from Rust,
   * out of the `webview-prefs.json` mirror — see
   * `src-tauri/src/usage_limits/mod.rs`.
   */
  cliUsageLimits: boolean;
  /** Point size for agent terminal sessions in the dock and fullscreen dialog. */
  agentTerminalFontSize: number;
  /**
   * When no project is open and at least one agent is running, open the
   * Agent Console instead of showing the start screen. Off by default: the
   * console replacing the start screen unasked would surprise a first launch.
   */
  agentConsoleAutoOpen: boolean;
  /**
   * Keep the Agent Console's activity feed on disk instead of in memory only.
   * Off by default: writing a record of what agents did to the user's machine
   * is a choice they make, never one an install makes for them.
   */
  agentLogPersist: boolean;
  /** How long stored activity is kept, in days. `0` is no age limit. */
  agentLogRetentionDays: number;
}

export const APP_CONFIG_DEFAULTS: AppConfig = {
  enableDeepNlp: false,
  markdownLintEnabled: true,
  mcpAutoStart: false,
  cliUsageLimits: false,
  agentTerminalFontSize: 14,
  agentConsoleAutoOpen: false,
  agentLogPersist: false,
  agentLogRetentionDays: 2,
};

/** The single read. Absent storage — SSR, tests, a blocked webview — is empty. */
export function readAppPref(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The single write. A full or blocked store costs the convenience, not the app. */
export function writeAppPref(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent(APP_CONFIG_CHANGED_EVENT, { detail: { key, value } }));
  } catch {
    // Storage full or blocked — losing the preference is survivable.
  }
}

export function removeAppPref(key: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Same reasoning as writeAppPref.
  }
}

function decodeBoolean(raw: string | null, fallback: boolean): boolean {
  if (raw !== 'true' && raw !== 'false') return fallback;
  return raw === 'true';
}

/**
 * Decodes a stored value that has to be one of a fixed set of numbers.
 *
 * An absent key is rejected before any conversion, because `Number(null)` is
 * `0` and `0` is a real choice in some of these sets — a never-written
 * retention span would otherwise decode as "no age limit".
 */
function decodeChoice(raw: string | null, allowed: readonly number[], fallback: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return allowed.includes(value) ? value : fallback;
}

export function loadAppConfig(): AppConfig {
  return {
    enableDeepNlp: decodeBoolean(
      readAppPref(APP_CONFIG_KEYS.enableDeepNlp),
      APP_CONFIG_DEFAULTS.enableDeepNlp
    ),
    markdownLintEnabled: decodeBoolean(
      readAppPref(APP_CONFIG_KEYS.markdownLintEnabled),
      APP_CONFIG_DEFAULTS.markdownLintEnabled
    ),
    mcpAutoStart: decodeBoolean(
      readAppPref(APP_CONFIG_KEYS.mcpAutoStart),
      APP_CONFIG_DEFAULTS.mcpAutoStart
    ),
    cliUsageLimits: decodeBoolean(
      readAppPref(APP_CONFIG_KEYS.cliUsageLimits),
      APP_CONFIG_DEFAULTS.cliUsageLimits
    ),
    agentTerminalFontSize: decodeChoice(
      readAppPref(APP_CONFIG_KEYS.agentTerminalFontSize),
      AGENT_TERMINAL_FONT_SIZES,
      APP_CONFIG_DEFAULTS.agentTerminalFontSize
    ),
    agentConsoleAutoOpen: decodeBoolean(
      readAppPref(APP_CONFIG_KEYS.agentConsoleAutoOpen),
      APP_CONFIG_DEFAULTS.agentConsoleAutoOpen
    ),
    agentLogPersist: decodeBoolean(
      readAppPref(APP_CONFIG_KEYS.agentLogPersist),
      APP_CONFIG_DEFAULTS.agentLogPersist
    ),
    agentLogRetentionDays: decodeChoice(
      readAppPref(APP_CONFIG_KEYS.agentLogRetentionDays),
      AGENT_LOG_RETENTION_DAYS,
      APP_CONFIG_DEFAULTS.agentLogRetentionDays
    ),
  };
}

export function setAppConfigValue<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
  writeAppPref(APP_CONFIG_KEYS[key], String(value));
}
