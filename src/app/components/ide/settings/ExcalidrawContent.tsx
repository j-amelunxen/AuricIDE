'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsInput } from '../../ui/settings/SettingsInput';

export function ExcalidrawContent() {
  const rootPath = useStore((s) => s.rootPath);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!rootPath) return;
    const load = async () => {
      const { dbGet } = await import('@/lib/tauri/db');
      const key = await dbGet(rootPath, 'excalidraw_settings', 'api_key');
      setApiKey(key || '');
      setLoading(false);
    };
    load();
  }, [rootPath]);

  const saveKey = async (value: string) => {
    if (!rootPath) return;
    const { dbSet } = await import('@/lib/tauri/db');
    await dbSet(rootPath, 'excalidraw_settings', 'api_key', value);
  };

  const handleTest = async () => {
    if (!rootPath) return;
    const { excalidrawTestConnection } = await import('@/lib/tauri/excalidraw');
    const { message } = await import('@tauri-apps/plugin-dialog');
    setTesting(true);
    try {
      const result = await excalidrawTestConnection(rootPath);
      await message(result, { title: 'Excalidraw+ Test', kind: 'info' });
    } catch (err) {
      await message(String(err), { title: 'Excalidraw+ Test Failed', kind: 'error' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="text-xs text-foreground-muted">Loading settings...</div>;

  return (
    <div className="space-y-6">
      <SettingsSection title="Excalidraw+" icon="draw">
        <p className="text-xs text-foreground-muted leading-relaxed">
          Connect your Excalidraw+ workspace to browse collections and mark diagrams as specs for
          this project. Create an API key in your Excalidraw+ workspace settings — it is stored in
          this project&apos;s local database only.
        </p>

        <SettingsInput
          label="API Key"
          type="password"
          value={apiKey}
          onChange={(val) => {
            setApiKey(val);
            saveKey(val);
          }}
          placeholder="Paste your Excalidraw+ API key"
          testId="excalidraw-api-key"
        />

        <div className="pt-2">
          <button
            data-testid="excalidraw-test-connection"
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
