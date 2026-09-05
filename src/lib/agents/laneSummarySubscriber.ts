import { useStore, type StoreState } from '../store';
import type { AgentInfo } from '../tauri/agents';
import { deriveFinishSummary } from './finishSummary';
import { extractAskSummary, resolveLaneSummary } from './laneSummary';

interface AgentTransitionState {
  awaitingInput: boolean;
  status: AgentInfo['status'];
}

interface AskPolishGuard {
  lastRequestedAt: number;
  inFlight: boolean;
}

/**
 * How long a genuine `ask` transition waits before this agent may ask an
 * LLM again. A redrawing permission menu can flip `awaitingInput`
 * false→true many times a second — `detectAwaitingInput` loses the prompt
 * out of its five-line window and finds it again — and each flip is a real
 * transition, never re-fired for itself (rule 18). Only a cooldown, not the
 * transition guard, keeps that from being one model call per flap.
 */
const ASK_POLISH_COOLDOWN_MS = 10_000;

/** Set once a subscription is live; cleared on teardown so a later install re-subscribes. */
let activeUnsubscribe: (() => void) | null = null;

function bumpGeneration(generation: Map<string, number>, agentId: string): number {
  const next = (generation.get(agentId) ?? 0) + 1;
  generation.set(agentId, next);
  return next;
}

/**
 * Extracts the right-away summary for a transition, by kind — the question
 * an `ask` names, or the last words of a finished `done`/`failed` run.
 */
function extractFor(kind: 'ask' | 'done' | 'failed', logs: string[]): string | null {
  return kind === 'ask' ? extractAskSummary(logs) : deriveFinishSummary(logs);
}

/**
 * One transition's summary: the extract goes up immediately, then a
 * configured LLM's polish replaces it if it lands in time. The polish only
 * lands if `token` is still this agent's current generation — a later
 * transition (the agent stopped waiting, or finished outright) bumps it, so
 * a polish that arrives after cannot resurrect a summary this agent has
 * already moved past.
 *
 * Only the `ask` kind is cooldown-guarded: `awaitingInput` can flap several
 * times a second as a permission menu redraws, and each flap is a genuine
 * transition (rule 18) that must not become its own LLM call. A `done`/
 * `failed` transition fires once per run and always resolves.
 */
async function pursueSummary(
  state: StoreState,
  agent: AgentInfo,
  kind: 'ask' | 'done' | 'failed',
  token: number,
  generation: Map<string, number>,
  askPolishGuards: Map<string, AskPolishGuard>
): Promise<void> {
  const logs = state.agentLogs[agent.id] ?? [];
  const extract = extractFor(kind, logs);
  if (extract) {
    state.setLaneSummary(agent.id, { kind, text: extract, at: Date.now(), source: 'extract' });
  }

  const projectPath = agent.repoPath ?? state.rootPath ?? null;
  const willAskLlm =
    kind === 'ask' && extract !== null && state.llmConfigured && projectPath !== null;
  if (willAskLlm) {
    const guard = askPolishGuards.get(agent.id);
    const now = Date.now();
    if (guard?.inFlight) return;
    if (guard && now - guard.lastRequestedAt < ASK_POLISH_COOLDOWN_MS) return;
    askPolishGuards.set(agent.id, { lastRequestedAt: now, inFlight: true });
  }

  try {
    const resolved = await resolveLaneSummary({
      kind,
      logs,
      extract: extract ?? undefined,
      task: agent.currentTask,
      llmConfigured: state.llmConfigured,
      projectPath,
    });
    if (resolved?.source === 'llm' && generation.get(agent.id) === token) {
      useStore.getState().setLaneSummary(agent.id, resolved);
    }
  } finally {
    if (willAskLlm) {
      const guard = askPolishGuards.get(agent.id);
      if (guard) guard.inFlight = false;
    }
  }
}

/**
 * Owns the per-agent bookkeeping (`previous`, `generation`, the ask-polish
 * guards) that watching the fleet for a transition needs, kept private so
 * `installLaneSummarySubscriber` cannot be called twice into two independent
 * sets of state by accident.
 */
function createLaneSummaryTracker() {
  const previous = new Map<string, AgentTransitionState>();
  const generation = new Map<string, number>();
  const askPolishGuards = new Map<string, AskPolishGuard>();

  /** Walks the fleet once, firing `pursueSummary` for every real transition. */
  function observe(state: StoreState): void {
    const seenIds = new Set<string>();

    for (const agent of state.agents) {
      seenIds.add(agent.id);
      const next: AgentTransitionState = {
        awaitingInput: agent.awaitingInput === true,
        status: agent.status,
      };
      const prev = previous.get(agent.id);
      previous.set(agent.id, next);
      if (!prev) continue;

      if (!prev.awaitingInput && next.awaitingInput) {
        const token = bumpGeneration(generation, agent.id);
        void pursueSummary(state, agent, 'ask', token, generation, askPolishGuards);
      } else if (prev.awaitingInput && !next.awaitingInput) {
        bumpGeneration(generation, agent.id);
        if (state.laneSummaries[agent.id]?.kind === 'ask') {
          state.clearLaneSummary(agent.id);
        }
      }

      if (prev.status !== next.status && (next.status === 'idle' || next.status === 'error')) {
        const token = bumpGeneration(generation, agent.id);
        void pursueSummary(
          state,
          agent,
          next.status === 'idle' ? 'done' : 'failed',
          token,
          generation,
          askPolishGuards
        );
      }
    }

    for (const id of previous.keys()) {
      if (!seenIds.has(id)) {
        previous.delete(id);
        generation.delete(id);
        askPolishGuards.delete(id);
        state.clearLaneSummary(id);
      }
    }
  }

  /** Forgets every agent's bookkeeping — called on teardown. */
  function reset(): void {
    previous.clear();
    generation.clear();
    askPolishGuards.clear();
  }

  return { observe, reset };
}

/**
 * Watches the fleet for the two transitions a lane summary is produced on
 * (`docs/design-console-lanes.md`, "Summaries"): an agent starting to wait on
 * input, and an agent stopping. A `previous` snapshot per agent both detects
 * the transition and doubles as the "already handled" marker — a re-render
 * carrying the same `awaitingInput`/`status` is indistinguishable from one
 * that already fired, so it cannot re-fire. An agent's first sighting (no
 * entry in `previous` yet) only seeds the baseline; it is not a transition,
 * so an agent that was already asking or already stopped when this
 * subscriber was installed does not retroactively summon a summary for it.
 *
 * Idempotent: a second call while a subscription is live returns the same
 * unsubscribe function rather than opening another one.
 *
 * `useStore.subscribe` fires on every write in the whole app — an editor
 * keystroke, a file-tree refresh, every PTY chunk — not just ones that touch
 * `agents`. Walking the fleet on each of those would be pure waste, so the
 * callback bails immediately unless `agents` is a new reference.
 *
 * Every transition this agent gets bumps its generation token before any
 * async work is dispatched with that token captured (see `pursueSummary`) —
 * that is what keeps a late `ask` polish from resurrecting a summary this
 * agent already cleared, or burying a `done`/`failed` summary that landed
 * while it was still in flight.
 *
 * An agent that drops out of `agents` (killed, dismissed, evicted) loses its
 * summary along with its markers — nothing else in the fleet reads a
 * summary for an id that no longer exists, so leaving it behind would only
 * be a session-lifetime leak.
 */
export function installLaneSummarySubscriber(): () => void {
  if (activeUnsubscribe) return activeUnsubscribe;

  const tracker = createLaneSummaryTracker();
  let lastAgents: AgentInfo[] | null = null;

  const unsubscribe = useStore.subscribe((state) => {
    if (state.agents === lastAgents) return;
    lastAgents = state.agents;
    tracker.observe(state);
  });

  activeUnsubscribe = () => {
    unsubscribe();
    tracker.reset();
    lastAgents = null;
    activeUnsubscribe = null;
  };
  return activeUnsubscribe;
}
