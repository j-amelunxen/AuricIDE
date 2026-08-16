'use client';

import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { dbGet, dbSet } from '@/lib/tauri/db';
import {
  getVideoImportPreflight,
  installLocalParakeet,
  SETUP_PROGRESS_EVENT,
  type Preflight,
  type PreflightCheck,
  type TranscriptionMode,
} from '@/lib/tauri/videoImport';
import { parseToolFailure, type ToolFailure } from '@/lib/videoImport/toolFailure';
import { ToolFailureNotice } from '../../videoImport/ToolFailureNotice';
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

/**
 * One dependency, stated the way a person can act on it: what we needed, what
 * is actually here, and the single command that closes the gap.
 */
function CheckRow({ check }: { check: PreflightCheck }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden
        className={`material-symbols-rounded mt-px text-[13px] leading-none ${
          check.ok ? 'text-emerald-400' : 'text-amber-400'
        }`}
      >
        {check.ok ? 'check_circle' : 'error'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[11px] font-semibold text-foreground">{check.label}</span>
          {check.found && (
            <span className="truncate font-mono text-[9px] text-foreground-muted/80">
              {check.found}
            </span>
          )}
          <span className="sr-only">{check.ok ? 'ready' : 'needs attention'}</span>
        </span>
        {!check.ok && (
          <span className="mt-0.5 block text-[10px] leading-relaxed text-foreground-muted">
            {check.detail} Required: {check.requirement}.
          </span>
        )}
        {check.fix && (
          <code className="mt-1 inline-block select-all rounded border border-white/5 bg-black/40 px-1.5 py-0.5 font-mono text-[9px] text-foreground-muted">
            {check.fix}
          </code>
        )}
      </span>
    </li>
  );
}

export function VideoImportContent() {
  const rootPath = useStore((s) => s.rootPath);
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<ToolFailure | null>(null);

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
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const runPreflight = useCallback(async () => {
    setChecking(true);
    try {
      setPreflight(await getVideoImportPreflight());
    } catch (reason) {
      setFailure(parseToolFailure(reason));
    } finally {
      setChecking(false);
    }
  }, []);

  // The first check needs no "Checking…" state of its own — the panel already
  // says so while there is no report yet.
  useEffect(() => {
    let cancelled = false;
    void getVideoImportPreflight()
      .then((report) => {
        if (!cancelled) setPreflight(report);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setFailure(parseToolFailure(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The install downloads well over a hundred megabytes and can take minutes.
  // Without this the panel is a button that says "Installing…" and nothing
  // else, which is indistinguishable from a hang.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<string>(SETUP_PROGRESS_EVENT, (event) => setProgress(String(event.payload)))
      )
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const save = <K extends keyof VideoImportSettings>(name: K, value: VideoImportSettings[K]) => {
    setSettings((current) => ({ ...current, [name]: value }));
    if (rootPath) void dbSet(rootPath, NS, KEY[name], String(value));
  };

  const install = async () => {
    setInstalling(true);
    setFailure(null);
    setProgress('Starting…');
    try {
      setPreflight(await installLocalParakeet());
    } catch (reason) {
      setFailure(parseToolFailure(reason));
      // The machine may have changed under us; show what is true now.
      await runPreflight();
    } finally {
      setInstalling(false);
      setProgress(null);
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

        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-foreground">Local runtime</p>
              <p className="mt-0.5 max-w-[60ch] text-[10px] leading-relaxed text-foreground-muted">
                {preflight?.ready
                  ? 'Everything local transcription needs is in place.'
                  : 'Local transcription is built on tools that come from this machine. They are checked here before anything runs.'}
              </p>
            </div>
            <button
              onClick={() => void runPreflight()}
              disabled={checking || installing}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50"
            >
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </div>

          {preflight ? (
            <ul className="mt-2 divide-y divide-white/5 border-t border-white/5 pt-1">
              {preflight.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[10px] text-foreground-muted">Checking dependencies…</p>
          )}

          {preflight && !preflight.ready && preflight.canInstall && (
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => void install()}
                disabled={installing}
                className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-[10px] font-bold text-primary-light transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                {installing ? 'Installing…' : 'Install local runtime'}
              </button>
              {installing && (
                <span
                  aria-live="polite"
                  className="min-w-0 flex-1 truncate font-mono text-[9px] text-foreground-muted"
                >
                  {progress ?? 'Working…'}
                </span>
              )}
            </div>
          )}

          {preflight && !preflight.canInstall && !preflight.ready && (
            <p className="mt-2 text-[10px] leading-relaxed text-amber-300/90">
              Local transcription can&apos;t run on this machine until the items above are resolved.
              A remote endpoint works in the meantime.
            </p>
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
        <ToolFailureNotice failure={failure} />
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
