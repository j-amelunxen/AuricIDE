'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsInput } from '../../ui/settings/SettingsInput';
import { CREDENTIAL_NAMESPACES, loadAppCredentials } from '@/lib/tauri/appCredentials';
import { loadProjectCredentials } from '@/lib/config/projectConfig';
import { isCredentialConfigured } from '@/lib/config/credentialStatus';
import { dbDelete, dbSet } from '@/lib/tauri/db';

export interface OverrideField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

interface CredentialOverrideProps {
  namespace: string;
  title: string;
  icon: string;
  blurb: string;
  fields: OverrideField[];
}

/** What a secret looks like when it is only being reported, never re-shown. */
function mask(value: string): string {
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

/**
 * A project's overrides for one credential namespace.
 *
 * The point of the screen is telling apart "this project sets its own" from
 * "this project uses the machine's". Without that distinction an inherited
 * value shown in a plain field would look like a project setting, and clearing
 * it would look like clearing the key everywhere.
 */
export function CredentialOverride({
  namespace,
  title,
  icon,
  blurb,
  fields,
}: CredentialOverrideProps) {
  const rootPath = useStore((s) => s.rootPath);
  const showToast = useStore((s) => s.showToast);
  const setLlmConfigured = useStore((s) => s.setLlmConfigured);
  const setJudgeLlmConfigured = useStore((s) => s.setJudgeLlmConfigured);
  const [global, setGlobal] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [globalValues, projectValues] = await Promise.all([
        loadAppCredentials(namespace),
        loadProjectCredentials(rootPath ?? '', namespace),
      ]);
      if (cancelled) return;
      setGlobal(globalValues);
      setOverrides(projectValues);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [namespace, rootPath]);

  /**
   * An override on a key is what decides whether a feature reads as configured,
   * so the switches gating on it have to hear about the change now rather than
   * on the next project open.
   */
  const republishConfigured = async (key: string) => {
    if (key !== 'api_key') return;
    if (namespace !== CREDENTIAL_NAMESPACES.llm && namespace !== CREDENTIAL_NAMESPACES.judge) {
      return;
    }
    const configured = await isCredentialConfigured(rootPath, namespace);
    if (namespace === CREDENTIAL_NAMESPACES.llm) setLlmConfigured(configured);
    else setJudgeLlmConfigured(configured);
  };

  const save = async (key: string, value: string) => {
    setOverrides((current) => ({ ...current, [key]: value }));
    if (!rootPath) return;
    try {
      // A blank override is removed rather than stored: an empty string parked
      // in the project would otherwise have to be read as "deliberately no
      // key here", which is not what clearing a field means.
      if (value.trim() === '') {
        await dbDelete(rootPath, namespace, key);
      } else {
        await dbSet(rootPath, namespace, key, value);
      }
      await republishConfigured(key);
    } catch (error) {
      showToast(`Could not save the override: ${String(error)}`, 'error');
    }
  };

  const stopOverriding = async (key: string) => {
    setOverrides((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (!rootPath) return;
    try {
      await dbDelete(rootPath, namespace, key);
      await republishConfigured(key);
    } catch (error) {
      showToast(`Could not remove the override: ${String(error)}`, 'error');
    }
  };

  if (!rootPath) {
    return (
      <div className="space-y-8">
        <SettingsSection title={title} icon={icon}>
          <p className="text-xs text-foreground-muted leading-relaxed">
            Open a project to give it settings of its own. Until then the application-wide values
            under Application → Credentials apply.
          </p>
        </SettingsSection>
      </div>
    );
  }

  if (loading) {
    return <p className="text-xs text-foreground-muted">Loading settings…</p>;
  }

  return (
    <div className="space-y-8">
      <SettingsSection title={title} icon={icon}>
        <p className="text-xs text-foreground-muted leading-relaxed">
          {blurb} This project inherits the values under Application → Credentials; set a field here
          only if it needs its own.
        </p>

        {fields.map((field) => {
          const overridden = Object.prototype.hasOwnProperty.call(overrides, field.key);
          const inherited = global[field.key] ?? '';
          const inheritedLabel = inherited
            ? field.secret
              ? mask(inherited)
              : inherited
            : 'not set';

          return (
            <div key={field.key} className="flex flex-col gap-1.5">
              {overridden ? (
                <>
                  <SettingsInput
                    label={field.label}
                    value={overrides[field.key] ?? ''}
                    onChange={(value) => void save(field.key, value)}
                    type={field.secret ? 'password' : 'text'}
                    placeholder={field.placeholder}
                    testId={`override-${namespace}-${field.key}`}
                  />
                  <button
                    onClick={() => void stopOverriding(field.key)}
                    className="self-start text-[10px] text-foreground-muted underline decoration-dotted hover:text-foreground"
                  >
                    Use the application value ({inheritedLabel})
                  </button>
                </>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded border border-border-dark bg-editor-bg/40 px-2 py-1.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-xs text-foreground">{field.label}</span>
                    <span className="truncate text-[10px] text-foreground-muted">
                      From Application: {inheritedLabel}
                    </span>
                  </div>
                  <button
                    onClick={() => setOverrides((current) => ({ ...current, [field.key]: '' }))}
                    data-testid={`override-start-${namespace}-${field.key}`}
                    className="flex-shrink-0 rounded border border-white/10 px-2 py-1 text-[10px] text-foreground-muted transition-colors hover:border-primary/30 hover:text-foreground"
                  >
                    Override here
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </SettingsSection>
    </div>
  );
}
