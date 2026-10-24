'use client';

import { useEffect, useMemo, useState } from 'react';
import { ManagerConfirmDialog } from '@/app/components/agents/SupervisorRunsPanel';
import { ManagerNameSheet } from '@/app/components/agents/ManagerNameSheet';
import { useAskManager } from '@/app/components/agents/useAskManager';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { liveSupervisorOfManager } from '@/lib/agents/managerStatus';
import { managerInstructionsPath } from '@/lib/agents/managerFolder';
import { runningSupervisors } from '@/lib/agents/supervisorLaunch';
import { keyFromName } from '@/lib/agents/supervisorManagers';
import { useOpenManager } from '@/lib/hooks/useOpenManager';
import { useProjectManagers } from '@/lib/hooks/useProjectManagers';
import { presentationOf, updateManagerPresentation } from '@/lib/quickAccess/managerPresentation';
import { loadSupervisorPresets } from '@/lib/quickAccess/supervisorPresets';
import { duplicateShortcuts, readMenuBarPrefs } from '@/lib/quickAccess/supervisorMenuBar';
import { useManagerPresentations } from '@/lib/quickAccess/useManagerPresentations';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import { openPathInDefaultApp, revealInFileManager } from '@/lib/tauri/opener';
import {
  managerArchive,
  managerCreate,
  managerRemove,
  managerRename,
  managerRestore,
  type SupervisorManager,
} from '@/lib/tauri/supervisorManagers';
import { supervisorRunsList, type SupervisorRun } from '@/lib/tauri/supervisorRuns';
import { ManagerSettingsRow } from './ManagerSettingsRow';
import { useSupervisorModels } from './useSupervisorModels';

const detailOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

type Confirmation =
  | { kind: 'restart'; manager: SupervisorManager; live: AgentInfo }
  | { kind: 'archive'; manager: SupervisorManager }
  | { kind: 'remove'; manager: SupervisorManager };

/**
 * Settings → Supervisor → Project Managers: every manager, how it is shown
 * (Quick Access, menu bar, shortcut, model) and the same inspector as the runs
 * rail. A manager is made here with "New Project Manager…", or by promoting a
 * run from the rail.
 */
export function SupervisorManagersSettings() {
  const { managers, error } = useProjectManagers();
  const presentations = useManagerPresentations();
  const agents = useStore((s) => s.agents);
  const killRunningAgent = useStore((s) => s.killRunningAgent);
  const showToast = useStore((s) => s.showToast);
  const { open } = useOpenManager();
  const { ask, sheet: askSheet } = useAskManager();
  const models = useSupervisorModels();
  const live = useMemo(() => runningSupervisors(agents), [agents]);
  const [runs, setRuns] = useState<SupervisorRun[]>([]);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<SupervisorManager | null>(null);
  const menuBar = readMenuBarPrefs();

  useEffect(() => {
    let current = true;
    supervisorRunsList().then(
      (listed) => current && setRuns(listed),
      () => current && setRuns([])
    );
    return () => {
      current = false;
    };
  }, [managers]);

  const active = managers.filter((manager) => manager.archivedAt === null);
  const archived = managers.filter((manager) => manager.archivedAt !== null);
  const runOf = (manager: SupervisorManager) =>
    runs.find((run) => run.name === manager.runDir) ?? null;

  // Skills come first when two picks claim the same keys, so they count as claims too.
  const claimed = duplicateShortcuts([
    ...loadSupervisorPresets().skills,
    ...active.map((manager) => ({
      shortcut: presentationOf(presentations, manager.key).shortcut ?? undefined,
    })),
  ]);

  const guarded = async (failure: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (cause) {
      showToast(`${failure}: ${detailOf(cause)}`, 'error');
    }
  };

  const showInFinder = (path: string | null, failure: string) =>
    guarded(failure, async () => {
      if (!path) throw new Error('its folder is gone');
      await revealInFileManager(path);
    });

  const openInDefaultApp = (path: string | null, failure: string) =>
    guarded(failure, async () => {
      if (!path) throw new Error('its folder is gone');
      await openPathInDefaultApp(path);
    });

  const confirmed = async (pending: Confirmation) => {
    setConfirmation(null);
    if (pending.kind === 'archive') {
      await guarded(`Could not archive ${pending.manager.name}`, () =>
        managerArchive(pending.manager.key)
      );
      return;
    }
    if (pending.kind === 'remove') {
      await guarded(`Could not remove ${pending.manager.name}`, () =>
        managerRemove(pending.manager.key)
      );
      return;
    }
    const stopped = await killRunningAgent(pending.live.id).then(
      () => true,
      (cause: unknown) => {
        showToast(`Could not stop ${pending.manager.name}: ${detailOf(cause)}`, 'error');
        return false;
      }
    );
    if (stopped) await open(pending.manager.key);
  };

  return (
    <SettingsSection title="Project Managers" icon="folder">
      <p className="text-xs leading-relaxed text-foreground-muted">
        A Project Manager is a supervisor with a name and a memory. Runs can also be promoted from
        the Supervisor Runs rail.
      </p>
      <div>
        <button
          type="button"
          onClick={error ? undefined : () => setCreating(true)}
          aria-disabled={!!error || undefined}
          aria-describedby={error ? 'manager-settings-error' : undefined}
          className={`rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold text-foreground transition-colors hover:bg-white/10 ${
            error ? 'cursor-not-allowed opacity-40' : ''
          }`}
        >
          New Project Manager…
        </button>
      </div>

      {active.length > 0 && !(menuBar.tray && menuBar.shortcuts) && (
        <p
          data-testid="manager-settings-menu-bar-note"
          className="text-[10px] text-foreground-muted"
        >
          {menuBar.tray
            ? 'Shortcuts only work from other apps once global shortcuts are on under Menu bar.'
            : 'The menu bar icon is off, so managers are not listed there yet. Switch it on under Menu bar.'}
        </p>
      )}

      {error && (
        <p
          id="manager-settings-error"
          role="alert"
          className="rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
        >
          {error}
        </p>
      )}

      {active.length === 0 && !error && (
        <p data-testid="manager-settings-empty" className="text-xs text-foreground-muted">
          No Project Managers yet.
        </p>
      )}

      {active.length > 0 && (
        <ul className="space-y-2">
          {active.map((manager) => {
            const presentation = presentationOf(presentations, manager.key);
            const run = runOf(manager);
            const liveSupervisor = liveSupervisorOfManager(live, manager.key);
            return (
              <ManagerSettingsRow
                key={manager.key}
                manager={manager}
                run={run}
                liveSupervisor={liveSupervisor}
                presentation={presentation}
                models={models}
                shortcutShared={!!presentation.shortcut && claimed.has(presentation.shortcut)}
                onChange={(patch) => updateManagerPresentation(manager.key, patch)}
                onOpen={() => void open(manager.key)}
                onAsk={() => ask(manager)}
                onRename={() => setRenaming(manager)}
                onArchive={() => setConfirmation({ kind: 'archive', manager })}
                onShowFile={(path) => void openInDefaultApp(path, 'Could not open the file')}
                onShowInstructions={() =>
                  void managerInstructionsPath(manager).then((path) =>
                    openInDefaultApp(path, 'Could not open the instructions')
                  )
                }
                onShowFolder={() =>
                  void showInFinder(run?.path ?? null, 'Could not show the folder')
                }
                onRestart={() =>
                  liveSupervisor &&
                  setConfirmation({ kind: 'restart', manager, live: liveSupervisor })
                }
              />
            );
          })}
        </ul>
      )}

      {archived.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setArchivedOpen((open) => !open)}
            aria-expanded={archivedOpen}
            className="flex items-center gap-1 rounded text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-muted/70 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
          >
            <AuricIcon
              name={archivedOpen ? 'expand_more' : 'chevron_right'}
              aria-hidden="true"
              className="text-[13px]"
            />
            Archived ({archived.length})
          </button>
          {archivedOpen && (
            <ul className="mt-2 space-y-1">
              {archived.map((manager) => (
                <li
                  key={manager.key}
                  className="flex items-center gap-2 rounded-lg border border-white/5 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
                    {manager.name}
                    {manager.runMissing && (
                      <span className="text-amber-200"> · Folder missing</span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={!!error}
                    title={error ?? undefined}
                    onClick={() =>
                      void guarded(`Could not restore ${manager.name}`, () =>
                        managerRestore(manager.key)
                      )
                    }
                    className="rounded px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    disabled={!!error}
                    title={error ?? undefined}
                    onClick={() => setConfirmation({ kind: 'remove', manager })}
                    className="rounded px-2 py-1 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Remove…
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {creating && (
        <ManagerNameSheet
          title="New Project Manager"
          confirmLabel="Create"
          initialName=""
          addressFor={(name) =>
            keyFromName(
              name,
              managers.map((manager) => manager.key)
            )
          }
          managers={managers}
          blockedReason={error ?? undefined}
          onSubmit={async (name) => {
            await managerCreate(name);
          }}
          onClose={() => setCreating(false)}
        >
          <p className="text-xs text-foreground-muted">
            It gets a folder of its own, an instructions file and a memory in knowledge/. Open it to
            put it to work.
          </p>
        </ManagerNameSheet>
      )}
      {renaming && (
        <ManagerNameSheet
          title="Rename Project Manager"
          confirmLabel="Rename"
          initialName={renaming.name}
          addressFor={() => renaming.key}
          managers={managers}
          exceptKey={renaming.key}
          blockedReason={error ?? undefined}
          onSubmit={async (name) => {
            await managerRename(renaming.key, name);
          }}
          onClose={() => setRenaming(null)}
        >
          <p className="text-xs text-foreground-muted">
            Address, folder, memory and the agents it started stay as they are. The heading of
            INSTRUCTIONS.md follows; your own text is not touched. A running manager keeps the old
            name until it restarts.
          </p>
        </ManagerNameSheet>
      )}
      {askSheet}
      {confirmation && (
        <ManagerConfirmDialog
          kind={confirmation.kind}
          name={confirmation.manager.name}
          onConfirm={() => void confirmed(confirmation)}
          onCancel={() => setConfirmation(null)}
        />
      )}
    </SettingsSection>
  );
}
