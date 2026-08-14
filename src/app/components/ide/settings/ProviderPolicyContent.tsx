'use client';

import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { listProviders, FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '@/lib/tauri/providers';
import { loadProviderPolicy, saveProviderPolicy } from '@/lib/config/projectConfig';
import {
  DEFAULT_PROVIDER_POLICY,
  isProviderAllowed,
  type ProviderPolicy,
} from '@/lib/config/providerPolicy';

type Mode = 'all' | 'allow';

/**
 * Which agent providers this project permits.
 *
 * Deliberately shows every provider the machine has, including the ones this
 * project blocks — a screen that hid them would give no way to unblock one.
 */
export function ProviderPolicyContent() {
  const rootPath = useStore((s) => s.rootPath);
  const showToast = useStore((s) => s.showToast);
  const [providers, setProviders] = useState<ProviderInfo[]>([FALLBACK_CRUSH_PROVIDER]);
  const [policy, setPolicy] = useState<ProviderPolicy>(DEFAULT_PROVIDER_POLICY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [fetched, stored] = await Promise.all([
        listProviders().catch(() => [FALLBACK_CRUSH_PROVIDER]),
        loadProviderPolicy(rootPath ?? ''),
      ]);
      if (cancelled) return;
      setProviders(fetched.length > 0 ? fetched : [FALLBACK_CRUSH_PROVIDER]);
      setPolicy(stored);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const persist = useCallback(
    async (next: ProviderPolicy) => {
      setPolicy(next);
      if (!rootPath) return;
      try {
        await saveProviderPolicy(rootPath, next);
      } catch {
        showToast('Could not save the provider policy', 'error');
      }
    },
    [rootPath, showToast]
  );

  const mode: Mode = policy.allow !== null && policy.allow.length > 0 ? 'allow' : 'all';

  const permitted = (id: string) => isProviderAllowed(id, policy);

  const setMode = (next: Mode) => {
    // Switching to an allow list starts from what is permitted right now, so
    // the rule does not change the moment the mode does.
    void persist(
      next === 'all'
        ? { ...policy, allow: null }
        : { ...policy, allow: providers.filter((p) => permitted(p.id)).map((p) => p.id) }
    );
  };

  const toggle = (id: string, allowed: boolean) => {
    const deny = allowed ? policy.deny.filter((d) => d !== id) : [...new Set([...policy.deny, id])];
    const allow =
      policy.allow === null
        ? null
        : allowed
          ? [...new Set([...policy.allow, id])]
          : policy.allow.filter((a) => a !== id);
    void persist({ allow, deny });
  };

  const allowedNames = providers.filter((p) => permitted(p.id)).map((p) => p.name);

  if (!rootPath) {
    return (
      <div className="space-y-8">
        <SettingsSection title="Providers" icon="shield">
          <p className="text-xs text-foreground-muted leading-relaxed">
            Open a project to set which agent providers it permits.
          </p>
        </SettingsSection>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SettingsSection title="Providers" icon="shield">
        <p className="text-xs text-foreground-muted leading-relaxed">
          Which agent CLIs may run in this project. Enforced when an agent is spawned — by the
          conductor and by a retry as much as by the dialogs — not only hidden from the pickers.
        </p>

        <div className="flex gap-2" role="radiogroup" aria-label="Policy mode">
          {(
            [
              ['all', 'All except blocked'],
              ['allow', 'Only the selected'],
            ] as [Mode, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                mode === value
                  ? 'border-primary/40 bg-primary/15 text-primary-light'
                  : 'border-white/10 bg-white/5 text-foreground-muted hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1" data-testid="provider-policy-list">
          {loading ? (
            <p className="text-xs text-foreground-muted">Loading providers…</p>
          ) : (
            providers.map((provider) => (
              <label
                key={provider.id}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-foreground hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={permitted(provider.id)}
                  onChange={(e) => toggle(provider.id, e.target.checked)}
                  className="accent-[var(--primary)]"
                />
                <span>{provider.name}</span>
                <span className="ml-auto font-mono text-[10px] text-foreground-muted/60">
                  {provider.id}
                </span>
              </label>
            ))
          )}
        </div>

        {/* The rules in plain words: two lists and a mode are easy to
            misread, and the consequence only shows up at spawn time. */}
        <p
          data-testid="provider-policy-summary"
          className={`text-[11px] ${allowedNames.length === 0 ? 'text-red-400' : 'text-foreground-muted'}`}
        >
          {allowedNames.length === 0
            ? 'No provider is permitted here — no agent can be started in this project.'
            : `Permitted in this project: ${allowedNames.join(', ')}.`}
        </p>
      </SettingsSection>
    </div>
  );
}
