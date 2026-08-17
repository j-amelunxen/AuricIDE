import { useStore } from '@/lib/store';
import type { ScheduledRunDeps, ScheduledRunState } from './scheduledRun';

/** How often the project-load wait re-checks the store. */
const POLL_INTERVAL_MS = 100;

/** Polls `pred` until it is true or `timeoutMs` elapses. */
function pollUntil(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (pred()) {
      resolve(true);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (pred()) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, POLL_INTERVAL_MS);
  });
}

/**
 * The one place a `launchScheduledConductor` call's abstract deps become real
 * store calls — shared by the auto-start hook and the sidebar's manual Start
 * button, so the two paths cannot drift into starting a run differently.
 *
 * `openProject` is the caller's, not read from the store, because it is a
 * React handler (`handleOpenRecent`) that also resets tabs and the file tree —
 * work this module has no business duplicating.
 */
export function buildScheduledRunDeps(
  openProject: (path: string) => Promise<void>
): ScheduledRunDeps {
  return {
    getState: (): ScheduledRunState => {
      const state = useStore.getState();
      return {
        rootPath: state.rootPath,
        pmLoading: state.pmLoading,
        goalsLoading: state.goalsLoading,
        conductorRunning: state.conductorRunning,
      };
    },
    openProject,
    waitUntil: pollUntil,
    startConductor: (goalId, options) => useStore.getState().startConductor(goalId, options),
    conductorTick: () => useStore.getState().conductorTick(),
    prepareConductorPanel: ({ goalId, maxConcurrent, requireReview }) => {
      const store = useStore.getState();
      store.setSelectedGoalId(goalId);
      store.setConductorMaxConcurrent(maxConcurrent);
      store.setConductorRequireReview(requireReview);
      store.openWorkPlace('goals');
    },
    toast: (message, variant) => {
      useStore.getState().showToast(message, variant);
    },
  };
}
