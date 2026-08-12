import type { StateCreator } from 'zustand';
import type { AgentConfig, PermissionMode } from '../tauri/agents';
import { FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '../tauri/providers';
import {
  comboStepForAgent as lookupComboStep,
  type ComboStepView,
  type SkillComboRun,
} from '../quickAccess/combo';
import type { QuickAccessCombo, QuickAccessSkill } from './starredProjectsSlice';

export type { SkillComboRun } from '../quickAccess/combo';

export interface SkillComboSlice {
  comboRuns: SkillComboRun[];
  startSkillCombo: (projectPath: string, combo: QuickAccessCombo) => Promise<void>;
  cancelSkillCombo: (runId: string) => void;
  cancelSkillCombosForAgents: (agentIds: string[]) => void;
  rebindSkillComboAgent: (fromAgentId: string, toAgentId: string) => void;
  skillComboHandleAgentEnded: (agentId: string) => Promise<void>;
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
  providers: ProviderInfo[]
): AgentConfig {
  const provider =
    (step.providerId ? providers.find((p) => p.id === step.providerId) : undefined) ??
    providers[0] ??
    FALLBACK_CRUSH_PROVIDER;
  const folder = projectPath.split('/').pop() || undefined;
  return {
    name: `${combo.label} · ${step.label || folder || 'step'}`,
    model: step.model || provider.defaultModel,
    task: step.prompt,
    cwd: projectPath,
    permissionMode: (step.permissionMode ?? provider.defaultPermissionMode) as PermissionMode,
    provider: provider.id,
  };
}

async function spawnStep(
  get: () => ComboHost,
  run: SkillComboRun,
  index: number
): Promise<string | null> {
  const host = get();
  if (!host.spawnNewAgent) return null;
  const step = run.steps[index];
  if (!step) return null;
  const providers = host.providers?.length ? host.providers : [FALLBACK_CRUSH_PROVIDER];
  const agent = await host.spawnNewAgent(
    resolveStepConfig({ label: run.label }, step, run.projectPath, providers)
  );
  return agent.id;
}

export const createSkillComboSlice: StateCreator<SkillComboSlice> = (set, get) => ({
  comboRuns: [],

  startSkillCombo: async (projectPath, combo) => {
    const steps = combo.steps.filter((step) => step.prompt.trim().length > 0);
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
    set({ comboRuns: [...get().comboRuns, run] });

    try {
      const agentId = await spawnStep(get as () => ComboHost, run, 0);
      if (!agentId) {
        set({ comboRuns: get().comboRuns.filter((r) => r.id !== run.id) });
        return;
      }
      set({
        comboRuns: get().comboRuns.map((r) =>
          r.id === run.id ? { ...r, currentAgentId: agentId } : r
        ),
      });
    } catch {
      set({ comboRuns: get().comboRuns.filter((r) => r.id !== run.id) });
      const toaster = get() as ComboHost;
      toaster.showToast?.(`Could not start ${combo.label}`, 'error');
    }
  },

  cancelSkillCombo: (runId) => {
    set({ comboRuns: get().comboRuns.filter((run) => run.id !== runId) });
  },

  cancelSkillCombosForAgents: (agentIds) => {
    const gone = new Set(agentIds);
    set({
      comboRuns: get().comboRuns.filter(
        (run) => !run.currentAgentId || !gone.has(run.currentAgentId)
      ),
    });
  },

  rebindSkillComboAgent: (fromAgentId, toAgentId) => {
    set({
      comboRuns: get().comboRuns.map((run) =>
        run.currentAgentId === fromAgentId ? { ...run, currentAgentId: toAgentId } : run
      ),
    });
  },

  skillComboHandleAgentEnded: async (agentId) => {
    const run = get().comboRuns.find((candidate) => candidate.currentAgentId === agentId);
    if (!run) return;

    const nextIndex = run.currentIndex + 1;
    if (nextIndex >= run.steps.length) {
      set({ comboRuns: get().comboRuns.filter((r) => r.id !== run.id) });
      return;
    }

    try {
      const nextAgentId = await spawnStep(get as () => ComboHost, run, nextIndex);
      if (!nextAgentId) {
        set({ comboRuns: get().comboRuns.filter((r) => r.id !== run.id) });
        return;
      }
      set({
        comboRuns: get().comboRuns.map((r) =>
          r.id === run.id ? { ...r, currentIndex: nextIndex, currentAgentId: nextAgentId } : r
        ),
      });
    } catch {
      set({ comboRuns: get().comboRuns.filter((r) => r.id !== run.id) });
      const toaster = get() as ComboHost;
      toaster.showToast?.(`Could not start the next step of ${run.label}`, 'error');
    }
  },

  comboStepForAgent: (agentId) => lookupComboStep(get().comboRuns, agentId),
});
