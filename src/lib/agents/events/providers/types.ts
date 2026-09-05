import type { AgentEvent } from '../types';

/** Classifies one already-clean (ANSI-stripped) line of agent output. */
export type LineMatcher = (line: string) => Omit<AgentEvent, 'at'> | null;
