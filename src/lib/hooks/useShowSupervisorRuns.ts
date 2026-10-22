'use client';

import { useEffect } from 'react';
import { SHOW_SUPERVISOR_RUNS_EVENT } from '@/lib/agents/showSupervisorRuns';

const SUPERVISOR_RUNS_ACTIVITY = 'supervisor-runs';

/** Brings the Supervisor Runs rail forward when a surface outside the shell asks for it. */
export function useShowSupervisorRuns(setActiveActivity: (id: string) => void): void {
  useEffect(() => {
    const show = () => setActiveActivity(SUPERVISOR_RUNS_ACTIVITY);
    window.addEventListener(SHOW_SUPERVISOR_RUNS_EVENT, show);
    return () => window.removeEventListener(SHOW_SUPERVISOR_RUNS_EVENT, show);
  }, [setActiveActivity]);
}
