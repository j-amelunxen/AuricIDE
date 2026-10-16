'use client';

import { useState } from 'react';
import { findRunningSupervisor } from '@/lib/agents/supervisorLaunch';
import { launchEntries } from '@/lib/quickAccess/launchSkills';
import { menuSkillEntries } from '@/lib/quickAccess/menuSkills';
import { saveSupervisorPresets } from '@/lib/quickAccess/supervisorPresets';
import { useSupervisorPresets } from '@/lib/quickAccess/useSupervisorPresets';
import { loadAuricSkills, resolveAuricSkillReference } from '@/lib/settings/auricSkills';
import { useStore } from '@/lib/store';
import type { SupervisorSkillLaunch } from '@/lib/store/agent/agentTypes';
import type { QuickAccessSkill } from '@/lib/store/starredProjectsSlice';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SupervisorQuickAccessDialog } from './QuickAccessSettingsDialog';
import { useLaunchWheel } from './useLaunchWheel';

/** The wheel id of the supervisor tile. Project wheels use absolute paths, so it cannot clash. */
export const SUPERVISOR_WHEEL_ID = 'supervisor';

/** Past this many, the right-click menu stops being a shortcut; the rest are in the dialog. */
const MAX_MENU_SKILLS = 8;

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
 * The dock's one fixed tile. One supervisor at a time: while one runs, the
 * tile brings it forward instead of starting another. With nothing allowed in
 * Settings → Supervisor it goes there, since a supervisor that may touch no
 * project could only tell the user the same thing more slowly.
 *
 * Otherwise it behaves like a project tile: hover or hold opens its skill
 * wheel, right-click lists its skills, and "Quick Access Settings" edits
 * them. A skill starts a supervisor with its prompt as the first task, or
 * goes to the running one as a message.
 */
export function SupervisorTile({
  onOpenSettings,
  onSelectAgent,
  wheelSuppressed = false,
  onWheelActivity,
}: SupervisorTileProps & SupervisorTileWheelProps) {
  const runningId = useStore((s) => findRunningSupervisor(s.agents)?.id ?? null);
  const spawnSupervisor = useStore((s) => s.spawnSupervisor);
  const selectAgent = useStore((s) => s.selectAgent);
  const showToast = useStore((s) => s.showToast);
  const presets = useSupervisorPresets();
  const [starting, setStarting] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const show = (agentId: string) => (onSelectAgent ?? selectAgent)(agentId);

  const open = async (skill?: QuickAccessSkill) => {
    if (starting) return;
    const resolved = skill ? resolveAuricSkillReference(skill) : undefined;
    const launch: SupervisorSkillLaunch | undefined = resolved
      ? { task: resolved.prompt, model: resolved.model }
      : undefined;
    setStarting(true);
    try {
      const result = await spawnSupervisor(launch);
      if (result.kind === 'nothing-visible') {
        showToast('Allow at least one project for the supervisor first', 'info');
        onOpenSettings?.('supervisor');
        return;
      }
      if (result.kind === 'sent') {
        showToast(`Sent "${resolved?.label ?? 'skill'}" to the running supervisor`, 'success');
      }
      show(result.agent.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      showToast(`Could not start the supervisor: ${detail}`, 'error');
    } finally {
      setStarting(false);
    }
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
    entries: launchEntries(presets.skills, []),
    storedSlots: presets.wheelSlots,
    writeSlots: (wheelSlots) => saveSupervisorPresets({ ...presets, wheelSlots }),
    onLaunch: (entry) => {
      if (entry.kind === 'skill') void open(entry.skill);
    },
    onConfigure: () => setSettingsOpen(true),
    suppressed: wheelSuppressed,
    onActivity: (active) => onWheelActivity?.(active),
  });

  const menuSkills = menuSkillEntries(presets.skills, loadAuricSkills());
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
      label: runningId ? 'Open Supervisor' : 'Start Supervisor',
      icon: 'bolt',
      action: () => void open(),
    },
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

  const label = runningId ? 'Open the running supervisor' : 'Start a supervisor agent';

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
          data-running={runningId !== null}
          onClick={() => {
            if (consumedClick) return;
            void open();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
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
          {runningId && (
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
          options={menuOptions}
          onClose={() => setMenu(null)}
        />
      )}
      {settingsOpen && <SupervisorQuickAccessDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
