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
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!rootPath) return;
    const load = async () => {
      const { dbGet } = await import('@/lib/tauri/db');
      const b = await dbGet(rootPath, 'llm_settings', 'base_url');
      const k = await dbGet(rootPath, 'llm_settings', 'api_key');
      const m = await dbGet(rootPath, 'llm_settings', 'model');
      const r = await dbGet(rootPath, 'llm_settings', 'reasoning_enabled');
      setBaseUrl(b || 'https://openrouter.ai/api/v1');
      setApiKey(k || '');
      setModel(m || 'moonshotai/kimi-k2-thinking');
      setReasoningEnabled(r !== 'false'); // Default to true if not set
      setLlmConfigured(!!k);
      setLoading(false);
    };
    load();
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

  if (loading) return <div className="text-xs text-foreground-muted">Loading settings...</div>;

  return (
    <div className="space-y-6">
      <SettingsSection title="LLM Configuration" icon="psychology">
        <SettingsToggle
          label="Enable Reasoning"
          description="Mandatory for Kimi Thinking on OpenRouter"
          tooltip="Enables Chain-of-Thought / Thinking models via 'reasoning: { enabled: true }' flag."
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
