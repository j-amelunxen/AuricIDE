'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsToggle } from '../../ui/settings/SettingsToggle';
import { SettingsInput } from '../../ui/settings/SettingsInput';

const JUDGE_NS = 'judge_llm_settings';

/**
 * Configures the SEPARATE model that reviews an agent's claimed work. It is
 * deliberately independent of the implementer's LLM (that lives in LlmContent):
 * the whole point of the judge is that the one who builds it does not sign it
 * off. Everything here writes the `judge_llm_settings` namespace and the Test
 * button runs through the judge role.
 */
export function JudgeLlmContent() {
  const rootPath = useStore((s) => s.rootPath);
  const setJudgeLlmConfigured = useStore((s) => s.setJudgeLlmConfigured);
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
      const b = await dbGet(rootPath, JUDGE_NS, 'base_url');
      const k = await dbGet(rootPath, JUDGE_NS, 'api_key');
      const m = await dbGet(rootPath, JUDGE_NS, 'model');
      const r = await dbGet(rootPath, JUDGE_NS, 'reasoning_enabled');
      setBaseUrl(b || 'https://openrouter.ai/api/v1');
      setApiKey(k || '');
      setModel(m || '');
      setReasoningEnabled(r !== 'false');
      setJudgeLlmConfigured(!!k);
      setLoading(false);
    };
    load();
  }, [rootPath, setJudgeLlmConfigured]);

  const saveSetting = async (key: string, value: string) => {
    if (!rootPath) return;
    const { dbSet } = await import('@/lib/tauri/db');
    await dbSet(rootPath, JUDGE_NS, key, value);
    if (key === 'api_key') {
      setJudgeLlmConfigured(!!value);
    }
  };

  const handleCopyFromLlm = async () => {
    if (!rootPath) return;
    const { dbGet, dbSet } = await import('@/lib/tauri/db');
    const b = (await dbGet(rootPath, 'llm_settings', 'base_url')) || 'https://openrouter.ai/api/v1';
    const k = (await dbGet(rootPath, 'llm_settings', 'api_key')) || '';
    const m = (await dbGet(rootPath, 'llm_settings', 'model')) || '';
    const r = (await dbGet(rootPath, 'llm_settings', 'reasoning_enabled')) ?? 'true';
    setBaseUrl(b);
    setApiKey(k);
    setModel(m);
    setReasoningEnabled(r !== 'false');
    await Promise.all([
      dbSet(rootPath, JUDGE_NS, 'base_url', b),
      dbSet(rootPath, JUDGE_NS, 'api_key', k),
      dbSet(rootPath, JUDGE_NS, 'model', m),
      dbSet(rootPath, JUDGE_NS, 'reasoning_enabled', r),
    ]);
    setJudgeLlmConfigured(!!k);
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
        role: 'judge',
        maxTokens: 10,
      });
      await message(`Success! Response: ${res.content}`, {
        title: 'Judge Model Test',
        kind: 'info',
      });
    } catch (err) {
      await message(String(err), { title: 'Judge Model Test Failed', kind: 'error' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="text-xs text-foreground-muted">Loading settings...</div>;

  return (
    <div className="space-y-6">
      <SettingsSection title="Judge Model" icon="gavel">
        <p className="text-[11px] leading-relaxed text-foreground-muted">
          The independent reviewer that verifies an agent&apos;s claimed work before it counts. Use
          a different — ideally stronger — model than the implementer, so the one who builds the
          work is not the one who signs it off. Without a key here, a claim stays blocking and is
          never auto-approved.
        </p>

        <div className="pt-1">
          <button
            data-testid="judge-copy-from-llm"
            onClick={handleCopyFromLlm}
            className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-foreground-muted uppercase tracking-wider transition-colors hover:bg-white/10 hover:text-foreground"
          >
            Copy from LLM settings
          </button>
        </div>

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
          hint="OpenAI-compatible API endpoint for the judge model"
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
          placeholder="anthropic/claude-opus-4"
        />

        <div className="pt-2">
          <button
            data-testid="judge-test-connection"
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
