import { useStore } from '@/lib/store';
import { getConductorPreflight } from '@/lib/store/conductorSlice';
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
    // The panel's own preflight, so "there is work" means the same thing to a
    // schedule as it does to the Start button a human looks at.
    readyTicketCount: (goalId) => {
      const state = useStore.getState();
      return getConductorPreflight({
        tickets: state.pmDraftTickets ?? [],
        dependencies: state.pmDraftDependencies ?? [],
        goals: state.goalsDraft ?? [],
        goalId,
        // A fresh run clears both ledgers, so counting against the previous
        // run's would hide work this one would happily pick up.
        failedTickets: {},
        approvedTickets: [],
      }).ready;
    },
    prepareConductorPanel: ({
      goalId,
      maxConcurrent,
      requireReview,
      judgeForm,
      judgeProviderId,
      judgeModel,
    }) => {
      const store = useStore.getState();
      store.setSelectedGoalId(goalId);
      store.setConductorMaxConcurrent(maxConcurrent);
      store.setConductorRequireReview(requireReview);
      // Absent means the schedule said nothing about the judge; the project's
      // own choice stands rather than being overwritten with a default.
      if (judgeForm !== undefined) store.setConductorJudgeForm(judgeForm);
      if (judgeProviderId !== undefined) store.setConductorJudgeProviderId(judgeProviderId);
      if (judgeModel !== undefined) store.setConductorJudgeModel(judgeModel);
      store.openWorkPlace('goals');
    },
    toast: (message, variant) => {
      useStore.getState().showToast(message, variant);
    },
  };
}
