import type { QuickAccessCombo, QuickAccessSkill } from '../store/starredProjectsSlice';

/** A running chain: one combo, one current agent, the rest still waiting. */
export interface SkillComboRun {
  id: string;
  comboId: string;
  label: string;
  projectPath: string;
  steps: QuickAccessSkill[];
  currentIndex: number;
  currentAgentId: string | null;
}

export interface ComboStepView {
  label: string;
  stepLabel: string;
  stepIndex: number;
  total: number;
}

export function comboMenuLabel(combo: QuickAccessCombo): string {
  return `${combo.label} +`;
}

/** The step names joined with pluses — the preview of what the combo will fire. */
export function comboPreview(combo: QuickAccessCombo): string {
  return combo.steps
    .map((step) => step.label.trim())
    .filter(Boolean)
    .join(' + ');
}

export function formatComboProgress(stepIndex: number, total: number): string {
  return `${stepIndex + 1} / ${total}`;
}

export function comboStepForAgent(runs: SkillComboRun[], agentId: string): ComboStepView | null {
  const run = runs.find((candidate) => candidate.currentAgentId === agentId);
  if (!run) return null;
  const step = run.steps[run.currentIndex];
  return {
    label: run.label,
    stepLabel: step?.label ?? '',
    stepIndex: run.currentIndex,
    total: run.steps.length,
  };
}
