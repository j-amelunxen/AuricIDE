import type { AgentState } from '@/lib/agents/state';

/** Muted by default — the chip states a fact, it does not compete with the name. */
export const STATE_CHIP: Record<AgentState, string> = {
  working: 'border-primary/30 bg-primary/10 text-primary-light',
  waiting: 'border-amber-500/25 bg-amber-500/10 text-amber-400/90',
  // The one running state that is actually blocked on the user — a shade
  // firmer than waiting (brighter text), still quieter than a failure
  // (border stays below error's 30% alpha).
  'needs-input': 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  stalled: 'border-orange-400/25 bg-orange-400/10 text-orange-300',
  done: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400/90',
  error: 'border-red-400/30 bg-red-400/10 text-red-400',
  queued: 'border-white/10 bg-white/5 text-foreground-muted',
};

// The card preview is ~10 lines tall — rendering the whole retained buffer
// (up to MAX_AGENT_LOG_BYTES) per streamed chunk wastes CPU for nothing.
export const LOG_PREVIEW_CHUNKS = 50;
