import { dbGet, dbList, dbSet } from '@/lib/tauri/db';
import { parseIgnoredRepos, serializeIgnoredRepos } from './ignoredRepos';
import {
  DEFAULT_PROVIDER_POLICY,
  parseProviderPolicy,
  serializeProviderPolicy,
  type ProviderPolicy,
} from './providerPolicy';

/**
 * Settings that belong to one project rather than to the machine.
 *
 * The dividing line: would the setting still be right if you opened a different
 * repository? A ticket-key pattern or a provider policy would not — those are
 * properties of this codebase and its rules. A theme or an API key would — they
 * live in `appConfig` / the application credentials store instead.
 *
 * Stored in the project's own database (`.auric/project.db`), so it travels with
 * the project and cannot leak into the next one.
 */
export const PROJECT_CONFIG_NAMESPACE = 'project_config';

export interface ProjectConfig {
  /** Let a finished agent commit its own work. */
  agenticCommit: boolean;
  agenticCommitPrompt: string;
  /** How a branch name reveals the ticket it belongs to. */
  branchTicketPattern: string;
  /** Which provider writes commits; empty means "whatever the agent used". */
  commitProviderId: string;
  /** Which provider the conductor spawns; empty means the launch default. */
  conductorProviderId: string;
  /** How a finished ticket is judged: an inline LLM call or a spawned reviewer. */
  conductorJudgeForm: string;
  /** Which provider reviews the work; empty means the conductor's own. */
  conductorJudgeProviderId: string;
  /** Which model reviews the work; empty means the conductor's own. */
  conductorJudgeModel: string;
}

export const PROJECT_CONFIG_DEFAULTS: ProjectConfig = {
  agenticCommit: true,
  agenticCommitPrompt:
    'commit on the current branch. Do not switch branches. Commit message prefix: {ticket}:',
  branchTicketPattern: '([A-Z]+-\\d+)',
  commitProviderId: '',
  conductorProviderId: '',
  conductorJudgeForm: 'llm',
  conductorJudgeProviderId: '',
  conductorJudgeModel: '',
};

/** kv_store holds strings; booleans go in and come back out through here. */
function decode<K extends keyof ProjectConfig>(key: K, raw: string | null): ProjectConfig[K] {
  const fallback = PROJECT_CONFIG_DEFAULTS[key];
  if (raw === null) return fallback;
  if (typeof fallback === 'boolean') {
    // Anything that is not one of the two words is a value we did not write.
    // Taking the default beats guessing — a hand-edited "perhaps" should not
    // decide whether agents commit on their own.
    if (raw !== 'true' && raw !== 'false') return fallback;
    return (raw === 'true') as ProjectConfig[K];
  }
  return raw as ProjectConfig[K];
}

function encode(value: ProjectConfig[keyof ProjectConfig]): string {
  return typeof value === 'boolean' ? String(value) : value;
}

/**
 * Reads the whole config. A project that was never configured, a database that
 * is not reachable and browser mode all come back as the defaults — settings
 * are not worth failing a render over.
 */
export async function loadProjectConfig(rootPath: string): Promise<ProjectConfig> {
  if (!rootPath) return { ...PROJECT_CONFIG_DEFAULTS };

  const keys = Object.keys(PROJECT_CONFIG_DEFAULTS) as (keyof ProjectConfig)[];
  try {
    const raw = await Promise.all(
      keys.map((key) => dbGet(rootPath, PROJECT_CONFIG_NAMESPACE, key))
    );
    const config = { ...PROJECT_CONFIG_DEFAULTS };
    keys.forEach((key, index) => {
      // @ts-expect-error — decode narrows per key, which the loop cannot express.
      config[key] = decode(key, raw[index]);
    });
    return config;
  } catch {
    return { ...PROJECT_CONFIG_DEFAULTS };
  }
}

export async function setProjectConfigValue<K extends keyof ProjectConfig>(
  rootPath: string,
  key: K,
  value: ProjectConfig[K]
): Promise<void> {
  if (!rootPath) return;
  await dbSet(rootPath, PROJECT_CONFIG_NAMESPACE, key, encode(value));
}

// ── Provider policy ────────────────────────────────────────────────

/** Its own namespace: Rust reads this one straight off disk on the spawn path. */
export const PROVIDER_POLICY_NAMESPACE = 'provider_policy';
export const PROVIDER_POLICY_KEY = 'policy';

/**
 * Never throws and never returns a closed policy on failure. Without a project,
 * with an unreachable database or with a corrupt value, everything is
 * permitted — the same rule `src-tauri/src/provider_policy.rs` follows, so the
 * dialogs and the spawn gate stay in step even when things go wrong.
 */
export async function loadProviderPolicy(rootPath: string): Promise<ProviderPolicy> {
  if (!rootPath) return { ...DEFAULT_PROVIDER_POLICY };
  try {
    const raw = await dbGet(rootPath, PROVIDER_POLICY_NAMESPACE, PROVIDER_POLICY_KEY);
    return parseProviderPolicy(raw);
  } catch {
    return { ...DEFAULT_PROVIDER_POLICY };
  }
}

export async function saveProviderPolicy(rootPath: string, policy: ProviderPolicy): Promise<void> {
  if (!rootPath) return;
  await dbSet(
    rootPath,
    PROVIDER_POLICY_NAMESPACE,
    PROVIDER_POLICY_KEY,
    serializeProviderPolicy(policy)
  );
}

// ── Ignored nested git repos ───────────────────────────────────────

/** Its own namespace: Rust reads this on discovery and the dirty probe. */
const IGNORED_REPOS_NAMESPACE = 'ignored_repos';
const IGNORED_REPOS_KEY = 'paths';

/**
 * Nested work-trees this project does not want to see. Missing, unreadable
 * or corrupt storage comes back as "ignore nothing" — hiding every repo
 * because the settings blob broke would be worse than showing a noisy one.
 */
export async function loadIgnoredRepos(rootPath: string): Promise<string[]> {
  if (!rootPath) return [];
  try {
    const raw = await dbGet(rootPath, IGNORED_REPOS_NAMESPACE, IGNORED_REPOS_KEY);
    return parseIgnoredRepos(raw);
  } catch {
    return [];
  }
}

export async function saveIgnoredRepos(rootPath: string, paths: readonly string[]): Promise<void> {
  if (!rootPath) return;
  await dbSet(rootPath, IGNORED_REPOS_NAMESPACE, IGNORED_REPOS_KEY, serializeIgnoredRepos(paths));
}

// ── Credential overrides ───────────────────────────────────────────

/**
 * What this project overrides for one credential namespace — only the fields it
 * actually sets, so the caller can tell an override apart from an inherited
 * value and show the difference.
 */
export async function loadProjectCredentials(
  rootPath: string,
  namespace: string
): Promise<Record<string, string>> {
  if (!rootPath) return {};
  try {
    const entries = await dbList(rootPath, namespace);
    return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
  } catch {
    return {};
  }
}
