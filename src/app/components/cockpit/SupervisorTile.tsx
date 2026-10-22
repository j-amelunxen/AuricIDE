'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { runningSupervisors, supervisorUsingRunDir } from '@/lib/agents/supervisorLaunch';
import { openSupervisor, resumeSupervisor } from '@/lib/agents/openSupervisor';
import { RECENT_RUNS_IN_MENU, supervisorRunLabel } from '@/lib/agents/supervisorRuns';
import { useOpenManager } from '@/lib/hooks/useOpenManager';
import { useProjectManagers } from '@/lib/hooks/useProjectManagers';
import { launchEntries } from '@/lib/quickAccess/launchSkills';
import { menuSkillEntries, pinSlottedLibrarySkills } from '@/lib/quickAccess/menuSkills';
import { saveSupervisorPresets } from '@/lib/quickAccess/supervisorPresets';
import { useSupervisorPresets } from '@/lib/quickAccess/useSupervisorPresets';
import { loadAuricSkills } from '@/lib/settings/auricSkills';
import { useStore } from '@/lib/store';
import type { QuickAccessSkill } from '@/lib/store/starredProjectsSlice';
import type { AgentInfo } from '@/lib/tauri/agents';
import { supervisorRunsList, type SupervisorRun } from '@/lib/tauri/supervisorRuns';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SupervisorQuickAccessDialog } from './QuickAccessSettingsDialog';
import { useLaunchWheel } from './useLaunchWheel';

/** The wheel id of the supervisor tile. Project wheels use absolute paths, so it cannot clash. */
export const SUPERVISOR_WHEEL_ID = 'supervisor';

/** Past this many, the right-click menu stops being a shortcut; the rest are in the dialog. */
const MAX_MENU_SKILLS = 8;

/** How a supervisor is named to the user: the key it is addressed by, else its card name. */
const supervisorLabel = (agent: AgentInfo) => agent.supervisorKey || agent.name;

export interface SupervisorTileProps {
  /** Opens Settings at a section; the tile only ever asks for `supervisor`. */
  onOpenSettings?: (category: 'supervisor') => void;
  /** Selects an agent and shows its terminal, the way clicking its card does. */
  onSelectAgent?: (agentId: string) => void;
}

interface SupervisorTileWheelProps {
  /** Another tile's wheel is open; this one stays shut. */
  wheelSuppressed?: boolean;
  onWheelActivity?: (active: boolean) => void;
}

/**
 * The dock's one fixed tile. Several supervisors may run side by side: a
 * plain click brings the newest running one forward (or starts one), and the
 * right-click menu starts another or opens any that runs. With nothing
 * allowed in Settings → Supervisor it goes there, since a supervisor that may
 * touch no project could only tell the user the same thing more slowly.
 *
 * Otherwise it behaves like a project tile: hover or hold opens its skill
 * wheel, right-click lists its skills, and "Quick Access Settings" edits
 * them. A skill always starts a new supervisor with its prompt as the first
 * task.
 */
export function SupervisorTile({
  onOpenSettings,
  onSelectAgent,
  wheelSuppressed = false,
  onWheelActivity,
}: SupervisorTileProps & SupervisorTileWheelProps) {
  const agents = useStore((s) => s.agents);
  // Derived here, not in the selector: a fresh array from a zustand v5 selector loops React.
  const live = useMemo(() => runningSupervisors(agents), [agents]);
  const running = live.length > 0;
  const spawnSupervisor = useStore((s) => s.spawnSupervisor);
  const selectAgent = useStore((s) => s.selectAgent);
  const showToast = useStore((s) => s.showToast);
  const presets = useSupervisorPresets();
  const library = loadAuricSkills();
  const [starting, setStarting] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; stage: 'root' | 'managers' } | null>(
    null
  );
  const { managers } = useProjectManagers();
  const { open: openProjectManager } = useOpenManager({ onOpenSettings, onSelectAgent });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentRuns, setRecentRuns] = useState<SupervisorRun[]>([]);

  const show = (agentId: string) => (onSelectAgent ?? selectAgent)(agentId);

  const open = async (skill?: QuickAccessSkill, forceNew = false) => {
    if (starting) return;
    setStarting(true);
    try {
      await openSupervisor(
        { spawnSupervisor, showToast },
        skill,
        {
          onNothingVisible: () => onOpenSettings?.('supervisor'),
          onShow: show,
        },
        { forceNew }
      );
    } finally {
      setStarting(false);
    }
  };

  const resume = async (run: SupervisorRun) => {
    if (starting) return;
    setStarting(true);
    try {
      await resumeSupervisor({ spawnSupervisor, showToast }, run.path, {
        onNothingVisible: () => onOpenSettings?.('supervisor'),
        onShow: show,
      });
    } finally {
      setStarting(false);
    }
  };

  const readRecentRuns = useCallback(() => {
    supervisorRunsList()
      .then((runs) => setRecentRuns(runs.slice(0, RECENT_RUNS_IN_MENU)))
      .catch(() => undefined);
  }, []);

  // Read ahead, so the menu opens with its runs in place: entries that
  // arrive after it opened would move the item under the pointer.
  useEffect(readRecentRuns, [readRecentRuns]);

  const openMenu = (x: number, y: number) => {
    setMenu({ x, y, stage: 'root' });
    // Read again on every opening: runs end while the app is open, and
    // nothing watches the folder. The last list stays until this answers.
    readRecentRuns();
  };

  const {
    tileRef,
    wheelLive,
    consumedClick,
    containerHandlers,
    buttonHandlers,
    wheel,
    pickerMenu,
  } = useLaunchWheel({
    wheelId: SUPERVISOR_WHEEL_ID,
    entries: launchEntries(menuSkillEntries(presets.skills, library), []),
    storedSlots: presets.wheelSlots,
    writeSlots: (wheelSlots) =>
      saveSupervisorPresets({
        skills: pinSlottedLibrarySkills(presets.skills, wheelSlots, library),
        wheelSlots,
      }),
    onLaunch: (entry) => {
      if (entry.kind === 'skill') void open(entry.skill);
    },
    onConfigure: () => setSettingsOpen(true),
    suppressed: wheelSuppressed,
    onActivity: (active) => onWheelActivity?.(active),
  });

  // Every non-archived manager is reachable from here, whether or not it has a tile.
  const projectManagers = useMemo(
    () =>
      managers
        .filter((manager) => manager.archivedAt === null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [managers]
  );
  const managerOptions: ContextMenuOption[] = [
    { type: 'header', label: 'Project Managers' },
    ...projectManagers.map((manager) => ({
      label: manager.name,
      icon: 'account_tree',
      action: () => void openProjectManager(manager.key),
    })),
    { type: 'separator' },
    {
      label: 'Back',
      icon: 'arrow_back',
      keepOpen: true,
      action: () => setMenu((current) => current && { ...current, stage: 'root' }),
    },
  ];

  const menuSkills = menuSkillEntries(presets.skills, library);
  const shownSkills = menuSkills.slice(0, MAX_MENU_SKILLS);
  const menuOptions: ContextMenuOption[] = [
    ...(shownSkills.length > 0
      ? ([
          { type: 'header', label: 'Skills' },
          ...shownSkills.map((skill) => ({
            label: skill.label,
            icon: 'auto_awesome',
            action: () => void open(skill),
          })),
          ...(menuSkills.length > shownSkills.length
            ? [
                {
                  label: `${menuSkills.length - shownSkills.length} more…`,
                  icon: 'toc',
                  action: () => setSettingsOpen(true),
                },
              ]
            : []),
          { type: 'separator' },
        ] as ContextMenuOption[])
      : []),
    {
      label: running ? 'Start new Supervisor' : 'Start Supervisor',
      icon: 'bolt',
      action: () => void open(undefined, true),
    },
    ...live.map((agent) => ({
      label: `Open ${supervisorLabel(agent)}`,
      icon: 'open_in_new',
      action: () => show(agent.id),
    })),
    ...(recentRuns.length > 0
      ? ([
          { type: 'header', label: 'Resume Supervisor' },
          ...recentRuns.map((run) => {
            // A run folder holds one live supervisor at a time: that run opens it instead.
            const liveHere = supervisorUsingRunDir(live, run.path);
            return liveHere
              ? {
                  label: `${supervisorRunLabel(run.name)} · open in ${supervisorLabel(liveHere)}`,
                  icon: 'open_in_new',
                  action: () => show(liveHere.id),
                }
              : {
                  label: supervisorRunLabel(run.name),
                  icon: 'history',
                  action: () => void resume(run),
                };
          }),
          { type: 'separator' },
        ] as ContextMenuOption[])
      : []),
    ...(projectManagers.length > 0
      ? ([
          {
            label: 'Project Managers',
            icon: 'folder',
            keepOpen: true,
            action: () => setMenu((current) => current && { ...current, stage: 'managers' }),
          },
          { type: 'separator' },
        ] as ContextMenuOption[])
      : []),
    {
      label: 'Supervisor Permissions…',
      icon: 'shield',
      action: () => onOpenSettings?.('supervisor'),
    },
    { type: 'separator' },
    {
      label: 'Quick Access Settings',
      icon: 'settings',
      action: () => setSettingsOpen(true),
    },
  ];

  const label = running ? 'Open the running supervisor' : 'Start a supervisor agent';

  return (
    <div
      data-testid="quick-access-supervisor-item"
      {...containerHandlers}
      className={`relative flex w-20 flex-col items-center gap-1.5 ${wheelLive ? 'z-20' : ''}`}
    >
      <div className="relative h-10 w-10">
        <button
          ref={tileRef}
          type="button"
          data-testid="quick-access-supervisor"
          data-running={running}
          onClick={() => {
            if (consumedClick) return;
            void open();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            openMenu(event.clientX, event.clientY);
          }}
          {...buttonHandlers}
          disabled={starting}
          aria-label={label}
          title={starting ? 'Starting the supervisor…' : label}
          aria-busy={starting}
          className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 via-primary/10 to-transparent text-primary-light shadow-sm ring-1 ring-white/10 transition-[transform,box-shadow] duration-150 hover:shadow-[0_0_16px_rgba(var(--primary-rgb),0.18)] hover:ring-white/25 active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:cursor-progress disabled:opacity-70"
        >
          <AuricIcon
            name={starting ? 'progress_activity' : 'account_tree'}
            aria-hidden="true"
            className={`text-[20px] ${starting ? 'animate-spin motion-reduce:animate-none' : ''}`}
          />
          {running && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_0_2px_var(--background)]"
            />
          )}
        </button>
        {wheel}
      </div>
      <span className="max-w-full truncate text-[10px] font-medium text-foreground-muted">
        Supervisor
      </span>
      {pickerMenu}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          width={220}
          options={menu.stage === 'managers' ? managerOptions : menuOptions}
          onClose={() => setMenu(null)}
        />
      )}
      {settingsOpen && <SupervisorQuickAccessDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
