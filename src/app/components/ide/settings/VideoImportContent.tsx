'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { dbGet, dbSet } from '@/lib/tauri/db';
import {
  getLocalParakeetStatus,
  installLocalParakeet,
  type LocalParakeetStatus,
  type TranscriptionMode,
} from '@/lib/tauri/videoImport';
import { SettingsInput } from '../../ui/settings/SettingsInput';
import { SettingsSection } from '../../ui/settings/SettingsSection';

const NS = 'video_import_settings';

interface VideoImportSettings {
  transcriptionMode: TranscriptionMode;
  remoteEndpoint: string;
  remoteApiKey: string;
  remoteModel: string;
  localCommand: string;
  localArgs: string;
  visionEnabled: boolean;
}

const DEFAULTS: VideoImportSettings = {
  transcriptionMode: 'automatic',
  remoteEndpoint: '',
  remoteApiKey: '',
  remoteModel: 'nvidia/parakeet-tdt-0.6b-v3',
  localCommand: 'parakeet-mlx',
  localArgs: '{audio} --output-dir {outputDir} --output-format json --highlight-words',
  visionEnabled: true,
};

const KEY: Record<keyof VideoImportSettings, string> = {
  transcriptionMode: 'transcription_mode',
  remoteEndpoint: 'remote_endpoint',
  remoteApiKey: 'remote_api_key',
  remoteModel: 'remote_model',
  localCommand: 'local_command',
  localArgs: 'local_args',
  visionEnabled: 'vision_enabled',
};

export function VideoImportContent() {
  const rootPath = useStore((s) => s.rootPath);
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [localStatus, setLocalStatus] = useState<LocalParakeetStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    void Promise.all(
      (Object.keys(KEY) as Array<keyof VideoImportSettings>).map(async (name) => [
        name,
        await dbGet(rootPath, NS, KEY[name]),
      ])
    ).then((rows) => {
      if (cancelled) return;
      const next = { ...DEFAULTS };
      for (const [name, value] of rows as Array<[keyof VideoImportSettings, string | null]>) {
        if (value === null) continue;
        if (name === 'visionEnabled') next[name] = value !== 'false';
        else if (name === 'transcriptionMode') next[name] = value as TranscriptionMode;
        else next[name] = value;
      }
      setSettings(next);
      setLoading(false);
    });
    void getLocalParakeetStatus()
      .then(setLocalStatus)
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const save = <K extends keyof VideoImportSettings>(name: K, value: VideoImportSettings[K]) => {
    setSettings((current) => ({ ...current, [name]: value }));
    if (rootPath) void dbSet(rootPath, NS, KEY[name], String(value));
  };

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      setLocalStatus(await installLocalParakeet());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInstalling(false);
    }
  };

  if (!rootPath) {
    return (
      <p className="text-xs text-foreground-muted">Open a project to configure video import.</p>
    );
  }
  if (loading) return <div className="text-xs text-foreground-muted">Loading settings...</div>;

  return (
    <div className="space-y-6">
      <p className="text-xs text-foreground-muted leading-relaxed">
        These settings apply only to this project. AuricIDE uses the endpoint and API key in
        Application settings &gt; Credentials unless you override them here.
      </p>

      <SettingsSection title="Transcription" icon="graphic_eq">
        <label className="flex flex-col gap-1.5 text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
          Mode
          <select
            data-testid="video-transcription-mode"
            value={settings.transcriptionMode}
            onChange={(event) => save('transcriptionMode', event.target.value as TranscriptionMode)}
            className="rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs font-normal normal-case tracking-normal text-foreground outline-none transition-colors focus:border-primary/50"
          >
            <option value="automatic">Automatic: try remote, then local</option>
            <option value="local">Local Parakeet only</option>
            <option value="remote">Remote endpoint only</option>
          </select>
        </label>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5">
          <div>
            <p className="text-xs font-semibold text-foreground">Local Parakeet</p>
            <p className="mt-0.5 text-[10px] text-foreground-muted">
              {localStatus?.detail ?? 'Checking local runtime...'}
            </p>
          </div>
          {!localStatus?.available && (
            <button
              onClick={() => void install()}
              disabled={installing}
              className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-[10px] font-bold text-primary-light transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              {installing ? 'Installing...' : 'Install local runtime'}
            </button>
          )}
        </div>

        <SettingsInput
          label="Local command"
          value={settings.localCommand}
          onChange={(value) => save('localCommand', value)}
          placeholder="parakeet-mlx"
          hint="AuricIDE runs and monitors this command for local transcription."
        />
        <SettingsInput
          label="Local arguments"
          value={settings.localArgs}
          onChange={(value) => save('localArgs', value)}
          placeholder="{audio} --output-dir {outputDir} --output-format json --highlight-words"
          hint="Use {audio} and {outputDir} for files AuricIDE manages. The model downloads to AuricIDE data on first use."
        />
        {error && (
          <p role="alert" className="text-[11px] leading-relaxed text-red-400">
            {error}
          </p>
        )}
      </SettingsSection>

      <SettingsSection title="Remote Transcription" icon="cloud">
        <SettingsInput
          label="Endpoint"
          value={settings.remoteEndpoint}
          onChange={(value) => save('remoteEndpoint', value)}
          placeholder="https://transcription.example.com/v1/audio/transcriptions"
          hint="OpenAI-compatible transcription endpoint. Leave blank to use local Parakeet."
        />
        <SettingsInput
          label="API Key"
          type="password"
          value={settings.remoteApiKey}
          onChange={(value) => save('remoteApiKey', value)}
          placeholder="Optional bearer token"
        />
        <SettingsInput
          label="Model"
          value={settings.remoteModel}
          onChange={(value) => save('remoteModel', value)}
          placeholder="nvidia/parakeet-tdt-0.6b-v3"
        />
      </SettingsSection>

      <SettingsSection title="Process Analysis" icon="account_tree">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-xs font-semibold text-foreground">
              Analyze video frames
            </span>
            <span className="mt-0.5 block max-w-[56ch] text-[10px] leading-relaxed text-foreground-muted">
              Send sampled frames to the model selected in Settings &gt; LLM. Turn this off for
              text-only models. The full transcript and screenshots are still saved.
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.visionEnabled}
            onChange={(event) => save('visionEnabled', event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
        </label>
      </SettingsSection>
    </div>
  );
}
