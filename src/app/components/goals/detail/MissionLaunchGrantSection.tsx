'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  grantForRoot,
  LAUNCH_GRANTS_CHANGED_EVENT,
  MAX_GRANT_BUDGET,
  MAX_GRANT_CONCURRENT,
  revokeLaunchGrant,
  saveLaunchGrant,
  type LaunchGrant,
} from '@/lib/notifications/launchGrants';
import { onNotificationsChanged } from '@/lib/tauri/notifications';

export interface MissionLaunchGrantSectionProps {
  projectPath: string;
  rootGoalId: string;
  rootGoalName: string;
  labelCls: string;
}

/** `undefined` = not read yet; the grant rows are native and read async. */
type GrantState = LaunchGrant | null | undefined;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Jennifer's switch for one mission: may agents' launch requests for goals
 * under this root start without a click? The only writer of a launch grant.
 * The grant is a row in the app-global inbox db (see `launchGrants.ts`); the
 * switch changes only after the database acknowledged the write, and it
 * follows changes made in another app instance.
 */
export function MissionLaunchGrantSection({
  projectPath,
  rootGoalId,
  rootGoalName,
  labelCls,
}: MissionLaunchGrantSectionProps) {
  const [grant, setGrant] = useState<GrantState>(undefined);
  /** Reading the grant failed; cleared by the next successful read. */
  const [readError, setReadError] = useState<string | null>(null);
  /**
   * Grant or revoke was refused. Kept across the re-read that follows it:
   * a refused revoke (stale grant id, review r3 blocker 3) re-reads the grant
   * really in force, and the reason must stay visible next to it.
   */
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? readError;
  const [busy, setBusy] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(2);
  const [launchBudget, setLaunchBudget] = useState(10);

  const refresh = useCallback(() => {
    grantForRoot(projectPath, rootGoalId)
      .then((current) => {
        setGrant(current);
        setReadError(null);
      })
      .catch((err) => {
        setGrant(undefined);
        setReadError(`Could not read the launch grant: ${message(err)}`);
      });
  }, [projectPath, rootGoalId]);

  useEffect(() => {
    refresh();
    window.addEventListener(LAUNCH_GRANTS_CHANGED_EVENT, refresh);
    const unlisten = onNotificationsChanged(refresh);
    return () => {
      window.removeEventListener(LAUNCH_GRANTS_CHANGED_EVENT, refresh);
      unlisten();
    };
  }, [refresh]);

  const toggle = async () => {
    setBusy(true);
    try {
      if (grant) {
        await revokeLaunchGrant(grant.id);
        setGrant(null);
      } else {
        setGrant(
          await saveLaunchGrant({
            projectPath,
            rootGoalId,
            rootGoalName,
            maxConcurrent,
            launchBudget,
          })
        );
      }
      setActionError(null);
    } catch (err) {
      setActionError(`${grant ? 'Revoke' : 'Grant'} was not saved: ${message(err)}`);
      // Show what is really in force now, not what this panel last knew.
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const numberCls =
    'w-14 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-foreground outline-none focus:ring-1 focus:ring-primary/30';

  return (
    <div data-testid="launch-grant">
      <label className={labelCls}>Agent launches for this mission</label>
      <p data-testid="launch-grant-status" className="text-[10px] text-foreground-muted">
        {grant === undefined
          ? 'Automatic starts: unknown.'
          : grant
            ? `Requests for goals under this mission start on their own: ${grant.launchesUsed} of ${grant.launchBudget} starts used, at most ${grant.maxConcurrent} at a time. Waiting requests start too, up to that limit.`
            : 'Agent requests wait in the inbox until you click Start.'}
      </p>
      {error && (
        <p data-testid="launch-grant-error" role="alert" className="text-[10px] text-red-400">
          {error}
        </p>
      )}
      {grant === null && (
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-foreground-muted">
          <label className="flex items-center gap-1">
            At a time
            <input
              data-testid="launch-grant-concurrent"
              type="number"
              min={1}
              max={MAX_GRANT_CONCURRENT}
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(Number(e.target.value) || 1)}
              className={numberCls}
            />
          </label>
          <label className="flex items-center gap-1">
            Starts in total
            <input
              data-testid="launch-grant-budget"
              type="number"
              min={1}
              max={MAX_GRANT_BUDGET}
              value={launchBudget}
              onChange={(e) => setLaunchBudget(Number(e.target.value) || 1)}
              className={numberCls}
            />
          </label>
        </div>
      )}
      {grant !== undefined && (
        <button
          type="button"
          data-testid="launch-grant-toggle"
          onClick={() => void toggle()}
          disabled={busy}
          className="mt-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-bold text-foreground hover:bg-white/10 disabled:opacity-50"
        >
          {grant ? 'Revoke automatic starts' : 'Allow automatic starts'}
        </button>
      )}
    </div>
  );
}
