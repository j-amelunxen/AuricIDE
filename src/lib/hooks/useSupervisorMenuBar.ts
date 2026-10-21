'use client';

import { useEffect, useRef, useState } from 'react';
import { runningSupervisors } from '@/lib/agents/supervisorLaunch';
import { openSupervisor } from '@/lib/agents/openSupervisor';
import { APP_CONFIG_CHANGED_EVENT, APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { menuSkillEntries } from '@/lib/quickAccess/menuSkills';
import {
  formatAccelerator,
  menuBarConfig,
  readMenuBarPrefs,
} from '@/lib/quickAccess/supervisorMenuBar';
import { loadSupervisorPresets } from '@/lib/quickAccess/supervisorPresets';
import { useSupervisorPresets } from '@/lib/quickAccess/useSupervisorPresets';
import { loadAuricSkills } from '@/lib/settings/auricSkills';
import { useStore } from '@/lib/store';
import {
  MENU_BAR_LAUNCH_EVENT,
  menuBarSync,
  type MenuBarLaunchRequest,
  type ShortcutFailure,
} from '@/lib/tauri/menuBar';

const WATCHED_KEYS = new Set<string>([
  APP_CONFIG_KEYS.auricSkills,
  APP_CONFIG_KEYS.supervisorMenuBar,
  APP_CONFIG_KEYS.supervisorGlobalShortcuts,
]);

/**
 * Keeps the supervisor's menu bar icon and global shortcuts in step with its
 * Quick Access skills, and starts what they ask for. Main window only: the
 * agent window would answer every pick a second time.
 */
export function useSupervisorMenuBar(onOpenSettings: (category: 'supervisor') => void): void {
  const presets = useSupervisorPresets();
  // A count, not the list: a number is a stable selector result.
  const running = useStore((s) => runningSupervisors(s.agents).length);
  const [prefsRevision, setPrefsRevision] = useState(0);
  const reportedFailures = useRef('');
  const openSettingsRef = useRef(onOpenSettings);
  useEffect(() => {
    openSettingsRef.current = onOpenSettings;
  }, [onOpenSettings]);

  useEffect(() => {
    const onChange = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key && WATCHED_KEYS.has(key)) setPrefsRevision((n) => n + 1);
    };
    window.addEventListener(APP_CONFIG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(APP_CONFIG_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const config = menuBarConfig(presets, loadAuricSkills(), readMenuBarPrefs(), running);
    menuBarSync(config)
      .then((failures) => {
        if (!cancelled) reportFailures(failures, config.skills, reportedFailures);
      })
      // Browser mode: there is no menu bar to sync.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [presets, running, prefsRevision]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<MenuBarLaunchRequest>(MENU_BAR_LAUNCH_EVENT, (event) => {
          void launch(event.payload ?? {}, openSettingsRef.current);
        });
        if (disposed) stop();
        else unlisten = stop;
      } catch {
        // Browser mode — no menu bar to listen to.
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

/** Read at the moment of the pick, so an edit made since the last sync still counts. */
async function launch(
  { skillId, newSupervisor }: MenuBarLaunchRequest,
  onOpenSettings: (category: 'supervisor') => void
): Promise<void> {
  const store = useStore.getState();
  const skill = skillId
    ? menuSkillEntries(loadSupervisorPresets().skills, loadAuricSkills()).find(
        (entry) => entry.id === skillId
      )
    : undefined;
  if (skillId && !skill) {
    store.showToast('That supervisor skill no longer exists', 'error');
    return;
  }
  await openSupervisor(
    store,
    skill,
    {
      onNothingVisible: () => onOpenSettings('supervisor'),
      onShow: (agentId) => useStore.getState().selectAgent(agentId),
    },
    { forceNew: newSupervisor === true }
  );
}

/** One toast per distinct set of refusals, not one per sync. */
function reportFailures(
  failures: ShortcutFailure[],
  skills: { id: string; label: string }[],
  reported: { current: string }
): void {
  const key = failures.map((f) => `${f.skillId}=${f.shortcut}`).join('|');
  if (key === reported.current) return;
  reported.current = key;
  if (failures.length === 0) return;
  const lines = failures.map((failure) => {
    const label = skills.find((skill) => skill.id === failure.skillId)?.label ?? failure.skillId;
    return `${formatAccelerator(failure.shortcut)} for "${label}": ${failure.reason}`;
  });
  useStore.getState().showToast(`Shortcut not available — ${lines.join('; ')}`, 'error');
}
