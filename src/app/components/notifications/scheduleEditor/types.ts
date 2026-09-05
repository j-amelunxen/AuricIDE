import type { ProjectPickerOption } from '@/lib/projects/projectOptions';
import type { SkillLaunchPins } from '@/lib/agents/skillLaunch';
import type { ConductorLaunch, NotificationAction } from '@/lib/notifications/types';
import type { ProviderInfo } from '@/lib/tauri/providers';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';
import type { Schedule } from '@/lib/tauri/schedules';

/** The rhythms the form offers, in the words the user thinks in. */
export type RhythmChoice = 'daily' | 'weekly' | 'interval' | 'cron';

export interface ScheduleEditorProps {
  /** The schedule being edited, or null for a new one. */
  schedule: Schedule | null;
  /** Project a new schedule starts on; null means app-wide. */
  defaultProjectPath: string | null;
  defaultProjectName: string | null;
  /** Formatted next occurrences for the draft, from the backend. */
  preview: string[];
  starredProjects: StarredProject[];
  /** Every project the reminder can be aimed at, in the order they are offered. */
  projectOptions: ProjectPickerOption[];
  discoveredSkills: ProjectSkill[];
  /** The agent harnesses this machine offers, for the custom-agent launch. */
  providers: ProviderInfo[];
  onDraftChange: (draft: Schedule) => void;
  onSave: (draft: Schedule) => void;
  onCancel: () => void;
}

export type RunSkillAction = Extract<NotificationAction, { kind: 'run-skill' }>;
export type RunComboAction = Extract<NotificationAction, { kind: 'run-combo' }>;
export type RunConductorAction = Extract<NotificationAction, { kind: 'run-conductor' }>;

/**
 * The custom-agent launch, as far as this form owns it. Everything is optional
 * and an empty provider means "whatever I launched last" — the remembered
 * defaults stay reachable, so configuring nothing keeps working exactly as it
 * did. A model or a permission mode without a provider is not offered: both
 * only mean something relative to one harness.
 */
export type TaskLaunchDraft = SkillLaunchPins & {
  /** Absent means start on the click — the behaviour before auto existed. */
  launch?: 'auto' | 'direct';
  headless?: boolean;
};

/**
 * The conductor's run parameters. Unlike a skill or combo, nothing here names
 * something that lives outside this form — there is no live pin to fall out of
 * sync with — so the draft carries the values directly rather than through a
 * snapshot.
 */
export type ConductorActionDraft = {
  choice: 'conductor';
  ticketBudget: number;
  maxConcurrent: number;
  /** `null` means "all tickets in the project", not "not decided yet". */
  goalId: string | null;
  /** Snapshot for display; the id is what a run actually scopes to. */
  goalName: string | null;
  requireReview: boolean;
  /**
   * How the run judges, and on what. `null` throughout means "whatever the
   * project is set to" — a reminder that says nothing about the judge must not
   * overwrite a choice made in the Conductor panel, and a schedule saved before
   * these fields existed says nothing by definition.
   */
  judgeForm: 'llm' | 'agent' | null;
  judgeProviderId: string | null;
  judgeModel: string | null;
  launch: ConductorLaunch;
};

export const DEFAULT_CONDUCTOR_DRAFT: ConductorActionDraft = {
  choice: 'conductor',
  ticketBudget: 5,
  maxConcurrent: 1,
  goalId: null,
  goalName: null,
  requireReview: false,
  judgeForm: null,
  judgeProviderId: null,
  judgeModel: null,
  launch: 'auto',
};

export type ActionDraft =
  | { choice: 'none' }
  | ({ choice: 'task'; task: string } & TaskLaunchDraft)
  | { choice: 'skill'; snapshot?: RunSkillAction }
  | { choice: 'combo'; snapshot?: RunComboAction }
  | ConductorActionDraft;

export const DISCOVERED_PREFIX = 'discovered:';
