'use client';

import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { isCredentialConfigured } from '@/lib/config/credentialStatus';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsInput } from '../../ui/settings/SettingsInput';
import { SettingsToggle } from '../../ui/settings/SettingsToggle';
import {
  CREDENTIAL_NAMESPACES,
  loadAppCredentials,
  setAppCredential,
} from '@/lib/tauri/appCredentials';

interface Field {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  hint?: string;
}

interface Group {
  namespace: string;
  title: string;
  icon: string;
  blurb: string;
  fields: Field[];
  toggles?: { key: string; label: string; description: string; defaultOn: boolean }[];
}

/**
 * The keys and endpoints this machine uses, in one place.
 *
 * They used to live in each project's database, which meant re-typing every key
 * for every project you opened. A project can still override any of these — see
 * the matching screens under Project — but it no longer has to have its own.
 */
const GROUPS: Group[] = [
  {
    namespace: CREDENTIAL_NAMESPACES.llm,
    title: 'LLM',
    icon: 'psychology',
    blurb: 'The model behind analysis, generation and the conductor.',
    fields: [
      { key: 'base_url', label: 'Base URL', placeholder: 'https://openrouter.ai/api/v1' },
      { key: 'api_key', label: 'API Key', secret: true },
      { key: 'model', label: 'Model', placeholder: 'moonshotai/kimi-k2-thinking' },
    ],
    toggles: [
      {
        key: 'reasoning_enabled',
        label: 'Reasoning',
        description: 'Send the reasoning extension (OpenRouter only)',
        defaultOn: true,
      },
    ],
  },
  {
    namespace: CREDENTIAL_NAMESPACES.judge,
    title: 'Judge',
    icon: 'gavel',
    blurb: 'A second model that reviews claimed work. Independent of the one that built it.',
    fields: [
      { key: 'base_url', label: 'Base URL', placeholder: 'https://openrouter.ai/api/v1' },
      { key: 'api_key', label: 'API Key', secret: true },
      { key: 'model', label: 'Model', placeholder: 'moonshotai/kimi-k2-thinking' },
    ],
    toggles: [
      {
        key: 'reasoning_enabled',
        label: 'Reasoning',
        description: 'Send the reasoning extension (OpenRouter only)',
        defaultOn: true,
      },
    ],
  },
  {
    namespace: CREDENTIAL_NAMESPACES.excalidraw,
    title: 'Excalidraw+',
    icon: 'draw',
    blurb: 'Read scenes and collections from an Excalidraw+ workspace.',
    fields: [{ key: 'api_key', label: 'API Key', secret: true }],
  },
  {
    namespace: CREDENTIAL_NAMESPACES.videoImport,
    title: 'Video Import',
    icon: 'video_file',
    blurb: 'Where narrated recordings get transcribed.',
    fields: [
      { key: 'remote_endpoint', label: 'Remote Endpoint' },
      { key: 'remote_api_key', label: 'Remote API Key', secret: true },
      {
        key: 'remote_model',
        label: 'Remote Model',
        placeholder: 'nvidia/parakeet-tdt-0.6b-v3',
      },
      { key: 'local_command', label: 'Local Command', placeholder: 'parakeet-mlx' },
    ],
  },
];

export function CredentialsContent() {
  const showToast = useStore((s) => s.showToast);
  const rootPath = useStore((s) => s.rootPath);
  const setLlmConfigured = useStore((s) => s.setLlmConfigured);
  const setJudgeLlmConfigured = useStore((s) => s.setJudgeLlmConfigured);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);

  // Both flags go through the same resolver the rest of the app uses, so a key
  // the open project overrides counts here exactly as it counts at spend time.
  const refreshConfigured = useCallback(async () => {
    const [llm, judge] = await Promise.all([
      isCredentialConfigured(rootPath, CREDENTIAL_NAMESPACES.llm),
      isCredentialConfigured(rootPath, CREDENTIAL_NAMESPACES.judge),
    ]);
    setLlmConfigured(llm);
    setJudgeLlmConfigured(judge);
  }, [rootPath, setLlmConfigured, setJudgeLlmConfigured]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await Promise.all(
        GROUPS.map(async (group) => [group.namespace, await loadAppCredentials(group.namespace)])
      );
      if (cancelled) return;
      setValues(Object.fromEntries(loaded) as Record<string, Record<string, string>>);
      await refreshConfigured();
      if (cancelled) return;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshConfigured]);

  const save = async (namespace: string, key: string, value: string) => {
    setValues((current) => ({
      ...current,
      [namespace]: { ...current[namespace], [key]: value },
    }));
    try {
      await setAppCredential(namespace, key, value);
      if (
        key === 'api_key' &&
        (namespace === CREDENTIAL_NAMESPACES.llm || namespace === CREDENTIAL_NAMESPACES.judge)
      ) {
        // Clearing the field here does not necessarily leave the feature
        // unconfigured — the open project may still override it.
        await refreshConfigured();
      }
    } catch (error) {
      // A save that did not happen must not look like one that did.
      showToast(`Could not save the ${namespace} setting: ${String(error)}`, 'error');
    }
  };

  if (loading) {
    return <p className="text-xs text-foreground-muted">Loading credentials…</p>;
  }

  return (
    <div className="space-y-8">
      <p className="text-xs text-foreground-muted leading-relaxed">
        Keys and endpoints for this installation — they apply to every project you open. Stored
        outside any project, readable only by your account. A project that needs its own can
        override any of them under Project.
      </p>

      {GROUPS.map((group) => (
        <SettingsSection key={group.namespace} title={group.title} icon={group.icon}>
          <p className="text-xs text-foreground-muted leading-relaxed">{group.blurb}</p>
          {group.fields.map((field) => (
            <SettingsInput
              key={field.key}
              label={field.label}
              value={values[group.namespace]?.[field.key] ?? ''}
              onChange={(value) => void save(group.namespace, field.key, value)}
              placeholder={field.placeholder}
              type={field.secret ? 'password' : 'text'}
              hint={field.hint}
              testId={`credential-${group.namespace}-${field.key}`}
            />
          ))}
          {group.toggles?.map((toggle) => (
            <SettingsToggle
              key={toggle.key}
              label={toggle.label}
              description={toggle.description}
              checked={
                (values[group.namespace]?.[toggle.key] ?? String(toggle.defaultOn)) === 'true'
              }
              onChange={(checked) => void save(group.namespace, toggle.key, String(checked))}
            />
          ))}
        </SettingsSection>
      ))}
    </div>
  );
}
