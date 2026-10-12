'use client';

import { useCallback, useEffect } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useTitleBarGutter } from '@/lib/hooks/useTitleBarGutter';
import { isFinishedAgent } from '@/lib/agents/fleet';
import { installAgentWindowClient, sendAgentWindowAction } from '@/lib/agents/agentWindowClient';
import { AgentTerminalWorkspace } from '../components/agents/AgentTerminalWorkspace';
import { ToastHost } from '../components/ide/ToastHost';
import { AuricIcon } from '../components/ui/AuricIcon';

/**
 * The header is this window's title bar: it drags the window, keeps clear of
 * the traffic lights, and is exactly as tall as the row they are pinned to.
 */
const TITLE_BAR_ROW = {
  'data-tauri-drag-region': true,
  className: 'h-12 select-none py-0! pl-[calc(1.25rem+var(--titlebar-gutter,0px))]',
};

async function closeThisWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
}

/**
 * Hand the layout back and close. The main window opens its terminal modal on
 * the same agent once this window is gone.
 */
async function dockBack(): Promise<void> {
  const { agentWindowActiveAgentId, terminalGridCells, showToast } = useStore.getState();
  await sendAgentWindowAction({
    kind: 'dock',
    activeAgentId: agentWindowActiveAgentId,
    gridCells: terminalGridCells,
  });
  try {
    await closeThisWindow();
  } catch {
    showToast('Could not close this window', 'error');
  }
}

function DockButton() {
  return (
    <button
      onClick={() => void dockBack()}
      title="Back to main window"
      aria-label="Back to main window"
      className="rounded-lg p-2 text-foreground-muted hover:bg-white/10 hover:text-foreground transition-all"
    >
      <AuricIcon name="arrow_back" className="text-lg" />
    </button>
  );
}

/** Ending touches tickets, goals and worktrees, so the main window does it. */
function endAgent(target: AgentInfo): Promise<void> {
  return sendAgentWindowAction({
    kind: isFinishedAgent(target) ? 'dismiss' : 'kill',
    agentId: target.id,
  });
}

/**
 * The scratch folder belongs to the main window's project, so the screen is
 * read here and saved there. That window also says how it went — a toast here
 * would be claiming a result this window never sees.
 */
async function saveScreen(agentName: string, readScreen: () => string | null): Promise<void> {
  const screen = readScreen();
  if (screen === null) {
    useStore.getState().showToast('The terminal is still opening', 'info');
    return;
  }
  await sendAgentWindowAction({ kind: 'save-scratch', agentName, screen });
}

const canEndAny = () => true;

/**
 * The detached agent window (`docs/design-agent-window.md`): the terminals and
 * nothing else. Deliberately not the IDE — no project, no file watcher, no
 * control bridge, no close guard. Closing this window ends no work and asks
 * nothing; whatever has consequences is sent to the main window.
 */
export default function AgentWindowPage() {
  useTitleBarGutter();
  useEffect(() => installAgentWindowClient(), []);

  const agents = useStore((s) => s.agents);
  const activeAgentId = useStore((s) => s.agentWindowActiveAgentId);
  const setActiveAgentId = useStore((s) => s.setAgentWindowActiveAgentId);
  const errorDigest = useStore((s) =>
    activeAgentId ? (s.agentWindowErrorDigests[activeAgentId] ?? null) : null
  );
  const { confirm, confirmDialog } = useConfirm();

  const switchAgent = useCallback(
    (next: AgentInfo) => setActiveAgentId(next.id),
    [setActiveAgentId]
  );
  // The last tab was ended. The window stays: the roster decides what is left
  // to show, and a stopped agent is still there to be read.
  const stay = useCallback(() => {}, []);

  const agent = agents.find((a) => a.id === activeAgentId) ?? null;

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-[#050510]">
      {agent ? (
        <AgentTerminalWorkspace
          agent={agent}
          agents={agents}
          onSwitchAgent={switchAgent}
          onClose={stay}
          confirm={confirm}
          onEndAgent={endAgent}
          canEndAgent={canEndAny}
          onSaveScreen={saveScreen}
          errorDigest={errorDigest}
          headerActions={<DockButton />}
          closeLabel={null}
          headerProps={TITLE_BAR_ROW}
        />
      ) : (
        <>
          <div
            data-tauri-drag-region
            className="flex h-12 flex-shrink-0 select-none items-center justify-end border-b border-white/10 pr-5 pl-[calc(1.25rem+var(--titlebar-gutter,0px))]"
          >
            <DockButton />
          </div>
          <p className="m-auto text-sm text-foreground-muted">
            No agents here. Start one in the main window.
          </p>
        </>
      )}
      {confirmDialog}
      <ToastHost />
    </main>
  );
}
