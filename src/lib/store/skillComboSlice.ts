import type { StateCreator } from 'zustand';
import type { AgentConfig } from '../tauri/agents';
import { FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '../tauri/providers';
import { resolveSkillLaunch } from '../agents/skillLaunch';
import {
  comboStepForAgent as lookupComboStep,
  type ComboStepView,
  type SkillComboRun,
} from '../quickAccess/combo';
import { composeStepTask, deriveHandoffContext } from '../agents/handoff';
import type { QuickAccessCombo, QuickAccessSkill } from './starredProjectsSlice';
import { loadAuricSkills, resolveAuricSkillReference } from '../settings/auricSkills';

export type { SkillComboRun } from '../quickAccess/combo';

/** How the step that just ended left the world. */
export interface EndedStep {
  /** Everything that session printed, for the handoff. */
  logs?: string[];
  /** It stopped in error — its successor's instruction assumes work it never did. */
  failed?: boolean;
}

/** What the finished step leaves to the one after it. */
interface StepHandoff {
  /** The previous session's cleaned terminal tail, or null on the first step. */
  context: string | null;
  /** Which step it came from, so the receiving session can name its source. */
  fromLabel: string;
}

export interface SkillComboSlice {
  comboRuns: SkillComboRun[];
  startSkillCombo: (projectPath: string, combo: QuickAccessCombo) => Promise<void>;
  cancelSkillCombo: (runId: string) => void;
  cancelSkillCombosForAgents: (agentIds: string[]) => void;
  rebindSkillComboAgent: (fromAgentId: string, toAgentId: string) => void;
  /** Restores the chains that were still open when the app last quit. */
  loadSkillCombos: () => void;
  /**
   * After a restart, drop the chains whose agent did not come back. A step
   * that had already finished is not persisted as interrupted, so its chain
   * can never advance again — showing it would claim progress that cannot move.
   */
  reconcileSkillCombos: (reachableAgentIds: string[]) => void;
  /**
   * The current step ended and the human is done with it — start the next one,
   * carrying that session's raw output into its instruction. A step that
   * `failed` ends the chain instead: the next prompt was written for a world
   * the failed step was supposed to create.
   */
  skillComboHandleAgentEnded: (agentId: string, ended?: EndedStep) => Promise<void>;
  comboStepForAgent: (agentId: string) => ComboStepView | null;
}

type ComboHost = SkillComboSlice & {
  spawnNewAgent?: (config: AgentConfig) => Promise<{ id: string }>;
  providers?: ProviderInfo[];
  showToast?: (message: string, variant?: 'error' | 'success' | 'info') => number;
};

function resolveStepConfig(
  combo: { label: string },
  step: QuickAccessSkill,
  projectPath: string,
  providers: ProviderInfo[],
  handoff: StepHandoff
): AgentConfig {
  const launch = resolveSkillLaunch(step, providers);
  const folder = projectPath.split('/').pop() || undefined;
  return {
    name: `${combo.label} · ${step.label || folder || 'step'}`,
    model: launch.model,
    task: composeStepTask(step.prompt, handoff.context, handoff.fromLabel),
    // Recall is a list of things a person typed — the handoff does not belong
    // in it.
    historyPrompt: step.prompt,
    cwd: projectPath,
    permissionMode: launch.permissionMode,
    provider: launch.provider,
  };
}

async function spawnStep(
  get: () => ComboHost,
  run: SkillComboRun,
  index: number,
  handoff: StepHandoff
): Promise<string | null> {
  const host = get();
  if (!host.spawnNewAgent) return null;
  const step = run.steps[index];
  if (!step) return null;
  const providers = host.providers?.length ? host.providers : [FALLBACK_CRUSH_PROVIDER];
  const agent = await host.spawnNewAgent(
    resolveStepConfig({ label: run.label }, step, run.projectPath, providers, handoff)
  );
  return agent.id;
}

/** The first step inherits nothing — there is no session before it. */
const NO_HANDOFF: StepHandoff = { context: null, fromLabel: '' };

const STORAGE_KEY = 'auric-skill-combo-runs';

function persist(runs: SkillComboRun[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // Storage full or unavailable. Surviving a restart is a convenience; it
    // must never take a running chain down with it.
  }
}

function restore(): SkillComboRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (run): run is SkillComboRun =>
        !!run &&
        typeof run === 'object' &&
        typeof (run as SkillComboRun).id === 'string' &&
        Array.isArray((run as SkillComboRun).steps)
    );
  } catch {
    return [];
  }
}

export const createSkillComboSlice: StateCreator<SkillComboSlice> = (set, get) => {
  /**
   * The only way comboRuns changes. A chain spans agent lifetimes and now app
   * lifetimes too, so writing it and remembering it are the same act — a path
   * that set state without persisting would resurrect a stale chain later.
   */
  const commit = (runs: SkillComboRun[]) => {
    set({ comboRuns: runs });
    persist(runs);
  };

  return {
    comboRuns: [],

    startSkillCombo: async (projectPath, combo) => {
      const library = loadAuricSkills();
      const steps = combo.steps
        .map((step) => resolveAuricSkillReference(step, library))
        .filter((step) => step.prompt.trim().length > 0);
      if (steps.length === 0) return;

      const existing = get().comboRuns.find(
        (run) => run.comboId === combo.id && run.projectPath === projectPath
      );
      if (existing) {
        const toaster = get() as ComboHost;
        toaster.showToast?.(`${combo.label} is already running`, 'info');
        return;
      }

      const run: SkillComboRun = {
        id: crypto.randomUUID(),
        comboId: combo.id,
        label: combo.label,
        projectPath,
        steps,
        currentIndex: 0,
        currentAgentId: null,
      };
      commit([...get().comboRuns, run]);

      try {
        const agentId = await spawnStep(get as () => ComboHost, run, 0, NO_HANDOFF);
        if (!agentId) {
          commit(get().comboRuns.filter((r) => r.id !== run.id));
          return;
        }
        commit(
          get().comboRuns.map((r) => (r.id === run.id ? { ...r, currentAgentId: agentId } : r))
        );
      } catch {
        commit(get().comboRuns.filter((r) => r.id !== run.id));
        const toaster = get() as ComboHost;
        toaster.showToast?.(`Could not start ${combo.label}`, 'error');
      }
    },

    cancelSkillCombo: (runId) => {
      commit(get().comboRuns.filter((run) => run.id !== runId));
    },

    cancelSkillCombosForAgents: (agentIds) => {
      const gone = new Set(agentIds);
      commit(get().comboRuns.filter((run) => !run.currentAgentId || !gone.has(run.currentAgentId)));
    },

    rebindSkillComboAgent: (fromAgentId, toAgentId) => {
      commit(
        get().comboRuns.map((run) =>
          run.currentAgentId === fromAgentId ? { ...run, currentAgentId: toAgentId } : run
        )
      );
    },

    loadSkillCombos: () => {
      const restored = restore();
      if (restored.length > 0) set({ comboRuns: restored });
    },

    reconcileSkillCombos: (reachableAgentIds) => {
      const reachable = new Set(reachableAgentIds);
      const runs = get().comboRuns;
      const kept = runs.filter((run) => !!run.currentAgentId && reachable.has(run.currentAgentId));
      if (kept.length === runs.length) return;

      commit(kept);
      const lost = runs.filter((run) => !kept.includes(run));
      const toaster = get() as ComboHost;
      toaster.showToast?.(
        `${lost.map((run) => run.label).join(', ')} did not survive the restart`,
        'info'
      );
    },

    skillComboHandleAgentEnded: async (agentId, ended = {}) => {
      const run = get().comboRuns.find((candidate) => candidate.currentAgentId === agentId);
      if (!run) return;

      const stepLabel = run.steps[run.currentIndex]?.label ?? '';

      // Every later prompt was written for a world the failed step was supposed
      // to leave behind. Running them anyway spends real tokens building on
      // something that is not there. Retry is the way back: it rebinds the run
      // to the replacement before dismissing, so it never reaches this branch.
      if (ended.failed) {
        commit(get().comboRuns.filter((r) => r.id !== run.id));
        const toaster = get() as ComboHost;
        toaster.showToast?.(`${run.label} stopped — the step “${stepLabel}” failed`, 'error');
        return;
      }

      const nextIndex = run.currentIndex + 1;
      if (nextIndex >= run.steps.length) {
        commit(get().comboRuns.filter((r) => r.id !== run.id));
        return;
      }

      // No CLI in the registry can resume another session, and a chain may
      // switch harness between steps. What the finished step actually leaves
      // behind is the text it printed — so that is what travels.
      const handoff: StepHandoff = {
        context: deriveHandoffContext(ended.logs ?? []),
        fromLabel: stepLabel,
      };

      try {
        const nextAgentId = await spawnStep(get as () => ComboHost, run, nextIndex, handoff);
        if (!nextAgentId) {
          commit(get().comboRuns.filter((r) => r.id !== run.id));
          return;
        }
        commit(
          get().comboRuns.map((r) =>
            r.id === run.id ? { ...r, currentIndex: nextIndex, currentAgentId: nextAgentId } : r
          )
        );
      } catch {
        commit(get().comboRuns.filter((r) => r.id !== run.id));
        const toaster = get() as ComboHost;
        toaster.showToast?.(`Could not start the next step of ${run.label}`, 'error');
      }
    },

    comboStepForAgent: (agentId) => lookupComboStep(get().comboRuns, agentId),
  };
};
