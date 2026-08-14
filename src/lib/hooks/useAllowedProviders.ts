'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { filterProviders } from '@/lib/config/providerPolicy';
import { loadProviderPolicy } from '@/lib/config/projectConfig';
import { listProviders, type ProviderInfo } from '@/lib/tauri/providers';

export interface AllowedProviders {
  /** What this project permits, in the order the registry returned. */
  providers: ProviderInfo[];
  /**
   * The registry offered providers and the project's policy rejected every one
   * of them. Callers must say so — an empty picker with no explanation reads as
   * a bug, and the setting that caused it is two screens away.
   */
  blockedAll: boolean;
  /** False until the first answer arrives, so a picker can hold still. */
  ready: boolean;
}

/**
 * The provider list a dialog may offer, narrowed by the project's policy.
 *
 * Only ever a courtesy: `spawn_agent_impl` in Rust checks the same policy
 * before it launches anything, so a provider that slips through here — via a
 * dialog that has not been converted, the conductor, a retry — is still
 * refused. What this hook buys is that the refusal is rare and the picker
 * honest, not that the rule is enforced.
 */
export function useAllowedProviders(
  fallback: ProviderInfo,
  /**
   * Whose policy applies. Defaults to the open project, but a dialog that can
   * aim an agent at another repository must pass that repository's path — Rust
   * checks the policy of the directory the agent actually runs in, so filtering
   * by the open project would offer providers the spawn then refuses.
   */
  projectPath?: string
): AllowedProviders {
  const openProject = useStore((state) => state.rootPath);
  const rootPath = projectPath ?? openProject;
  const [state, setState] = useState<AllowedProviders>({
    providers: [fallback],
    blockedAll: false,
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Browser mode has no registry; the fallback still goes through the
      // policy, so a project that denies it sees the same message either way.
      const fetched = await listProviders().catch(() => [fallback]);
      const offered = fetched.length > 0 ? fetched : [fallback];
      const policy = await loadProviderPolicy(rootPath ?? '');
      if (cancelled) return;

      const allowed = filterProviders(offered, policy);
      setState({
        providers: allowed,
        blockedAll: allowed.length === 0,
        ready: true,
      });
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [rootPath, fallback]);

  return state;
}
