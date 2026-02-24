'use client';

import { useStore } from '@/lib/store';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsInput } from '../../ui/settings/SettingsInput';
import type { SyncStatus } from '@/lib/blueprints/serverSync';

function SyncStatusBadge({
  status,
  error,
}: {
  status: SyncStatus;
  error: string | null;
}) {
  if (status === 'idle') return null;

  const config: Record<
    Exclude<SyncStatus, 'idle'>,
    { icon: string; color: string; label: string }
  > = {
    syncing: { icon: 'sync', color: 'text-amber-400', label: 'Syncing…' },
    success: { icon: 'check_circle', color: 'text-emerald-400', label: 'Synced' },
    error: { icon: 'error', color: 'text-rose-400', label: error ?? 'Sync error' },
    unreachable: { icon: 'wifi_off', color: 'text-foreground-muted', label: 'Server unreachable' },
  };

  const { icon, color, label } = config[status as Exclude<SyncStatus, 'idle'>];

  return (
    <span className={`flex items-center gap-1 text-[10px] ${color}`} title={label}>
      <span
        className={`material-symbols-outlined text-[14px] ${status === 'syncing' ? 'animate-spin' : ''}`}
      >
        {icon}
      </span>
      {label}
    </span>
  );
}

export function BlueprintSyncContent() {
  const blueprintServerUrl = useStore((s) => s.blueprintServerUrl);
  const setBlueprintServerUrl = useStore((s) => s.setBlueprintServerUrl);
  const blueprintSyncStatus = useStore((s) => s.blueprintSyncStatus);
  const blueprintSyncError = useStore((s) => s.blueprintSyncError);
  const syncWithBlueprintServer = useStore((s) => s.syncWithBlueprintServer);
  const rootPath = useStore((s) => s.rootPath);

  return (
    <div className="space-y-6">
      <SettingsSection title="Blueprint Server" icon="sync">
        <SettingsInput
          label="Server URL"
          value={blueprintServerUrl}
          onChange={setBlueprintServerUrl}
          placeholder="https://blueprints.example.com"
          hint="Leave empty to disable automatic sync"
          testId="blueprint-server-url-input"
        />

        {blueprintServerUrl && (
          <div className="flex items-center gap-3">
            <SyncStatusBadge status={blueprintSyncStatus} error={blueprintSyncError} />
            <button
              disabled={blueprintSyncStatus === 'syncing' || !rootPath}
              onClick={() => rootPath && syncWithBlueprintServer(rootPath)}
              className="rounded border border-primary/20 bg-primary/10 px-4 py-1.5 text-[10px] font-bold text-primary-light uppercase tracking-wider transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              Sync Now
            </button>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
