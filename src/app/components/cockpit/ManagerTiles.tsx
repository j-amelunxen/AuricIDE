'use client';

import { useMemo, useState } from 'react';
import { liveSupervisorOfManager, managerStatus } from '@/lib/agents/managerStatus';
import { managerInstructionsPath } from '@/lib/agents/managerFolder';
import { requestShowSupervisorRuns } from '@/lib/agents/showSupervisorRuns';
import { runningSupervisors } from '@/lib/agents/supervisorLaunch';
import { useNowWhen } from '@/lib/hooks/useNow';
import { useOpenManager } from '@/lib/hooks/useOpenManager';
import { useProjectManagers } from '@/lib/hooks/useProjectManagers';
import { managersForQuickAccess } from '@/lib/quickAccess/managerPresentation';
import { useManagerPresentations } from '@/lib/quickAccess/useManagerPresentations';
import { useStore } from '@/lib/store';
import { managerArchive, type SupervisorManager } from '@/lib/tauri/supervisorManagers';
import { revealInFileManager } from '@/lib/tauri/opener';
import { ManagerConfirmDialog } from '@/app/components/agents/SupervisorRunsPanel';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { ManagerTile } from './ManagerTile';
import type { SupervisorTileProps } from './SupervisorTile';

const detailOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * One tile per non-archived Project Manager that is set to show here, by name,
 * after the Supervisor tile. With none, nothing is drawn: there is no empty
 * tile inviting promotion.
 */
export function ManagerTiles({ onOpenSettings, onSelectAgent }: SupervisorTileProps) {
  const { managers } = useProjectManagers();
  const presentations = useManagerPresentations();
  const agents = useStore((s) => s.agents);
  const projectOpen = useStore((s) => s.rootPath !== null);
  const showToast = useStore((s) => s.showToast);
  const { open, opening } = useOpenManager({ onOpenSettings, onSelectAgent });
  const [menu, setMenu] = useState<{ x: number; y: number; manager: SupervisorManager } | null>(
    null
  );
  const [archiving, setArchiving] = useState<SupervisorManager | null>(null);

  const tiles = useMemo(
    () =>
      [...managersForQuickAccess(managers, presentations)].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    [managers, presentations]
  );
  const live = useMemo(() => runningSupervisors(agents), [agents]);
  // Re-renders when a stall or a question starts, not every second.
  const now = useNowWhen((tick) =>
    tiles.map((tile) => managerStatus(liveSupervisorOfManager(live, tile.key), tick)).join()
  );

  if (tiles.length === 0) return null;

  const showInstructions = async (manager: SupervisorManager) => {
    try {
      const path = await managerInstructionsPath(manager);
      if (!path) throw new Error('its folder is gone');
      await revealInFileManager(path);
    } catch (cause) {
      showToast(`Could not show the instructions: ${detailOf(cause)}`, 'error');
    }
  };

  const archive = async (manager: SupervisorManager) => {
    setArchiving(null);
    try {
      await managerArchive(manager.key);
    } catch (cause) {
      showToast(`Could not archive ${manager.name}: ${detailOf(cause)}`, 'error');
    }
  };

  const menuOptions = (manager: SupervisorManager): ContextMenuOption[] => [
    { label: 'Open', icon: 'open_in_new', action: () => void open(manager.key) },
    {
      label: 'Show Instructions in Finder',
      icon: 'folder',
      action: () => void showInstructions(manager),
    },
    ...(projectOpen
      ? [{ label: 'Show in Runs', icon: 'history', action: requestShowSupervisorRuns }]
      : []),
    { type: 'separator' },
    { label: 'Archive…', icon: 'archive', action: () => setArchiving(manager) },
  ];

  return (
    <>
      {tiles.map((manager) => (
        <ManagerTile
          key={manager.key}
          name={manager.name}
          managerKey={manager.key}
          status={managerStatus(liveSupervisorOfManager(live, manager.key), now)}
          opening={opening === manager.key}
          onOpen={() => void open(manager.key)}
          onContextMenu={(event) => setMenu({ x: event.clientX, y: event.clientY, manager })}
        />
      ))}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          width={232}
          ariaLabel={`${menu.manager.name} actions`}
          options={menuOptions(menu.manager)}
          onClose={() => setMenu(null)}
        />
      )}
      {archiving && (
        <ManagerConfirmDialog
          kind="archive"
          name={archiving.name}
          onConfirm={() => void archive(archiving)}
          onCancel={() => setArchiving(null)}
        />
      )}
    </>
  );
}
