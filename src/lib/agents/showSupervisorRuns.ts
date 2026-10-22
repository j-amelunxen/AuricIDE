/**
 * Quick Access lives outside the IDE shell's state, but "Show in Runs" has to
 * bring the Supervisor Runs rail forward. The shell listens for this event
 * (`useShowSupervisorRuns`), so no callback has to be threaded through the
 * cockpit, the start screen and the switcher.
 */
export const SHOW_SUPERVISOR_RUNS_EVENT = 'auric:show-supervisor-runs';

export function requestShowSupervisorRuns(): void {
  window.dispatchEvent(new Event(SHOW_SUPERVISOR_RUNS_EVENT));
}
