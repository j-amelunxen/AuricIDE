'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsToggle } from '../../ui/settings/SettingsToggle';
import { SettingsInput } from '../../ui/settings/SettingsInput';

export function LlmContent() {
  const rootPath = useStore((s) => s.rootPath);
  const setLlmConfigured = useStore((s) => s.setLlmConfigured);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!rootPath) return;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const { dbGet } = await import('@/lib/tauri/db');
        const [b, k, m, r] = await Promise.all([
          dbGet(rootPath, 'llm_settings', 'base_url'),
          dbGet(rootPath, 'llm_settings', 'api_key'),
          dbGet(rootPath, 'llm_settings', 'model'),
          dbGet(rootPath, 'llm_settings', 'reasoning_enabled'),
        ]);
        setBaseUrl(b || 'https://openrouter.ai/api/v1');
        setApiKey(k || '');
        setModel(m || 'moonshotai/kimi-k2-thinking');
        setReasoningEnabled(r !== 'false'); // Default to true if not set
        setLlmConfigured(!!k);
      } catch (error) {
        setLoadError(`Could not load LLM settings: ${String(error)}`);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [rootPath, setLlmConfigured]);

  const saveSetting = async (key: string, value: string) => {
    if (!rootPath) return;
    const { dbSet } = await import('@/lib/tauri/db');
    await dbSet(rootPath, 'llm_settings', key, value);
    if (key === 'api_key') {
      setLlmConfigured(!!value);
    }
  };

  const handleTest = async () => {
    if (!rootPath) return;
    const { llmCall } = await import('@/lib/tauri/llm');
    const { message } = await import('@tauri-apps/plugin-dialog');
    setTesting(true);
    try {
      const res = await llmCall({
        messages: [{ role: 'user', content: 'Say "pong"' }],
        projectPath: rootPath,
        maxTokens: 10,
      });
      await message(`Success! Response: ${res.content}`, {
        title: 'LLM Test',
        kind: 'info',
      });
    } catch (err) {
      await message(String(err), { title: 'LLM Test Failed', kind: 'error' });
    } finally {
      setTesting(false);
    }
  };

  if (!rootPath)
    return (
      <div className="text-xs text-foreground-muted">Open a project to configure the LLM.</div>
    );
  if (loading) return <div className="text-xs text-foreground-muted">Loading settings...</div>;
  if (loadError) return <div className="text-xs text-red-400">{loadError}</div>;

  return (
    <div className="space-y-6">
      <SettingsSection title="LLM Configuration" icon="psychology">
        <SettingsToggle
          label="Enable Reasoning"
          description="For supported reasoning models on OpenRouter; automatically omitted for Mistral"
          tooltip="Sends OpenRouter's reasoning extension for compatible models. Mistral APIs reject this extension, so AuricIDE omits it automatically."
          checked={reasoningEnabled}
          onChange={(checked) => {
            setReasoningEnabled(checked);
            saveSetting('reasoning_enabled', String(checked));
          }}
        />

        <SettingsInput
          label="Base URL"
          value={baseUrl}
          onChange={(val) => {
            setBaseUrl(val);
            saveSetting('base_url', val);
          }}
          placeholder="https://openrouter.ai/api/v1"
          hint="OpenAI-compatible API endpoint (e.g. OpenRouter, DeepSeek, Local LLM)"
        />

        <SettingsInput
          label="API Key"
          type="password"
          value={apiKey}
          onChange={(val) => {
            setApiKey(val);
            saveSetting('api_key', val);
          }}
          placeholder="sk-or-v1-..."
        />

        <SettingsInput
          label="Model Name"
          value={model}
          onChange={(val) => {
            setModel(val);
            saveSetting('model', val);
          }}
          placeholder="moonshotai/kimi-k2-thinking"
        />

        <div className="pt-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="rounded border border-primary/20 bg-primary/10 px-4 py-1.5 text-[10px] font-bold text-primary-light uppercase tracking-wider transition-colors hover:bg-primary/20 disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}
