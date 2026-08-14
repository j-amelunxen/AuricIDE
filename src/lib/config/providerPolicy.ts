import type { ProviderInfo } from '../tauri/providers';

/**
 * Which agentic providers a project permits.
 *
 * `allow === null` means no allow list is in effect — the usual case. A list
 * narrows the project to exactly its members. `deny` always wins, so "this
 * selection, except that one" is expressible without editing the selection.
 *
 * Stored as JSON in the project database under the `provider_policy` namespace
 * and read from two places: the dialogs, to decide what to offer, and the Rust
 * spawn path, to decide what to actually run. Both go through this file's twin
 * in `src-tauri/src/provider_policy.rs`, and both are tested against
 * `providerPolicy.fixtures.json` so the offer and the decision cannot drift.
 */
export interface ProviderPolicy {
  allow: string[] | null;
  deny: string[];
}

export const DEFAULT_PROVIDER_POLICY: ProviderPolicy = { allow: null, deny: [] };

/** Provider ids are lowercase in the registry; a hand-typed entry must still match. */
function normalizeId(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = normalizeId(entry);
    if (id) seen.add(id);
  }
  return [...seen];
}

/**
 * Reads a stored policy. Anything unreadable — missing, empty, malformed,
 * wrong shape — becomes the open default rather than an error: a project that
 * cannot spawn anything because its settings blob got corrupted would be a far
 * worse failure than one that briefly permits too much.
 */
export function parseProviderPolicy(raw: string | null | undefined): ProviderPolicy {
  if (!raw) return { ...DEFAULT_PROVIDER_POLICY, deny: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { allow: null, deny: [] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { allow: null, deny: [] };
  }

  const source = parsed as { allow?: unknown; deny?: unknown };
  const allow = Array.isArray(source.allow) ? normalizeList(source.allow) : [];

  return {
    // An allow list that normalises to nothing is an absent one. Reaching that
    // state means the last entry was removed, which reads as "never mind the
    // whitelist" — not as "lock this project out of every provider". Denying
    // everything stays possible, but only by saying so on the deny list.
    allow: allow.length > 0 ? allow : null,
    deny: normalizeList(source.deny),
  };
}

export function serializeProviderPolicy(policy: ProviderPolicy): string {
  return JSON.stringify({ allow: policy.allow, deny: policy.deny });
}

export function isProviderAllowed(providerId: string, policy: ProviderPolicy): boolean {
  const id = normalizeId(providerId);
  if (!id) return false;
  if (policy.deny.includes(id)) return false;
  // Empty is absent here too, not only after parsing. The settings UI holds a
  // policy in component state while it is being edited, and unticking the last
  // provider must mean the same thing there as it does once saved.
  const hasAllowList = policy.allow !== null && policy.allow.length > 0;
  if (hasAllowList && !policy.allow!.includes(id)) return false;
  return true;
}

/**
 * Narrows a provider list to what the project permits, keeping the registry's
 * order — `list_providers` sorts the default provider first, and re-ordering
 * here would change which provider a dialog preselects.
 *
 * An empty result is a real answer, not a failure: callers must say that no
 * provider is available rather than render an empty picker.
 */
export function filterProviders(providers: ProviderInfo[], policy: ProviderPolicy): ProviderInfo[] {
  return providers.filter((provider) => isProviderAllowed(provider.id, policy));
}
