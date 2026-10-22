'use client';

import { useState } from 'react';
import { ManagerInspector } from '@/app/components/agents/ManagerInspector';
import { ShortcutRecorder } from '@/app/components/cockpit/ShortcutRecorder';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SettingsToggle } from '@/app/components/ui/settings/SettingsToggle';
import { managerMonogram } from '@/lib/agents/managerStatus';
import type { ManagerPresentation } from '@/lib/quickAccess/managerPresentation';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import type { SupervisorRun } from '@/lib/tauri/supervisorRuns';

interface ManagerSettingsRowProps {
  manager: SupervisorManager;
  /** The manager's folder; null when it is no longer where the registry says. */
  run: SupervisorRun | null;
  liveSupervisor: AgentInfo | undefined;
  presentation: ManagerPresentation;
  /** The shortcut is also claimed by a skill or another manager. */
  shortcutShared: boolean;
  onChange: (patch: Partial<ManagerPresentation>) => void;
  onOpen: () => void;
  onShowInstructions: () => void;
  onShowFolder: () => void;
  onRestart: () => void;
}

/**
 * One Project Manager in Settings: how it is shown, and the same inspector as
 * the runs rail, opened on demand. Settings has no editor and no file tree, so
 * "Edit" and the folder row go to Finder.
 */
export function ManagerSettingsRow({
  manager,
  run,
  liveSupervisor,
  presentation,
  shortcutShared,
  onChange,
  onOpen,
  onShowInstructions,
  onShowFolder,
  onRestart,
}: ManagerSettingsRowProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = `manager-details-${manager.key}`;
  return (
    <li
      data-testid={`manager-settings-${manager.key}`}
      className="rounded-lg border border-white/5 bg-black/20 px-3 py-3"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[11px] font-semibold tracking-wide text-primary-light ring-1 ring-white/10"
        >
          {managerMonogram(manager.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">{manager.name}</p>
          <p className="truncate text-[10px] text-foreground-muted">
            <span className="font-mono">{manager.key}</span>
            {' · '}
            {liveSupervisor ? <span className="text-primary">Running</span> : 'Not running'}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold text-foreground transition-colors hover:bg-white/10"
        >
          Open
        </button>
      </div>

      <div className="mt-3 space-y-3 border-t border-white/5 pt-3">
        <SettingsToggle
          label="Show in Quick Access"
          description="A tile after the Supervisor tile."
          checked={presentation.quickAccess}
          onChange={(quickAccess) => onChange({ quickAccess })}
          testId={`manager-quick-access-${manager.key}`}
        />
        <SettingsToggle
          label="Show in the menu bar"
          description="Listed under Project Managers in the menu bar icon."
          checked={presentation.menuBar}
          onChange={(menuBar) => onChange({ menuBar })}
          testId={`manager-menu-bar-${manager.key}`}
        />
        <div className="space-y-1">
          <span className="block text-xs text-foreground">Shortcut</span>
          <ShortcutRecorder
            value={presentation.shortcut ?? undefined}
            ariaLabel={`${manager.name} shortcut`}
            duplicate={shortcutShared}
            onChange={(shortcut) => onChange({ shortcut: shortcut ?? null })}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setDetailsOpen((open) => !open)}
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        className="mt-3 flex items-center gap-1 rounded text-[10px] font-semibold text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
      >
        <AuricIcon
          name={detailsOpen ? 'expand_more' : 'chevron_right'}
          aria-hidden="true"
          className="text-[14px]"
        />
        Details
      </button>
      {detailsOpen && (
        <div id={detailsId} className="-ml-6 mt-1">
          {run ? (
            <ManagerInspector
              manager={manager}
              run={run}
              liveSupervisor={liveSupervisor}
              folderOpen={false}
              reloadToken={0}
              onOpen={onOpen}
              onEditInstructions={onShowInstructions}
              onRestart={onRestart}
              onToggleFolder={onShowFolder}
            />
          ) : (
            <p className="pl-6 text-[11px] text-foreground-muted">
              Its folder is not where the registry expects it, so there is nothing to inspect.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
