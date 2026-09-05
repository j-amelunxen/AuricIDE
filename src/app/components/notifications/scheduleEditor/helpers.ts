import type { SkillLaunchPins } from '@/lib/agents/skillLaunch';
import { dailyCron, weeklyCron } from '@/lib/notifications/scheduleFormat';
import type { NotificationAction, NotificationLaunch } from '@/lib/notifications/types';
import type { ProjectPickerOption } from '@/lib/projects/projectOptions';
import type { QuickAccessCombo, QuickAccessSkill } from '@/lib/store/starredProjectsSlice';
import type { ProjectSkill, ProjectSkillScope } from '@/lib/tauri/projectSkills';
import type { Schedule, ScheduleCatchUp, SchedulePayload } from '@/lib/tauri/schedules';
import {
  DISCOVERED_PREFIX,
  type ActionDraft,
  type RhythmChoice,
  type RunComboAction,
  type RunConductorAction,
  type RunSkillAction,
} from './types';

export function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Same grouping Quick Access settings already uses. */
export const SCOPE_ORDER: { scope: ProjectSkillScope; title: string }[] = [
  { scope: 'project', title: 'In this project' },
  { scope: 'user', title: 'Your skills' },
];

/** Pinned projects lead the picker; everything else follows under one heading. */
export const PROJECT_GROUPS: { starred: boolean; title: string }[] = [
  { starred: true, title: 'Quick Access' },
  { starred: false, title: 'Recent' },
];

export const UTC_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Today at the given local wall-clock time, as a UTC timestamp. */
export function anchorFor(time: string): string {
  const [hour = '9', minute = '0'] = time.split(':');
  const local = new Date();
  local.setHours(Number(hour), Number(minute), 0, 0);
  return local.toISOString().replace('T', ' ').slice(0, 19);
}

export function parsePayload(raw: string): SchedulePayload {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as SchedulePayload) : {};
  } catch {
    return {};
  }
}

export function rhythmOf(schedule: Schedule | null): RhythmChoice {
  if (schedule === null) return 'weekly';
  if (schedule.specKind === 'every') return 'interval';
  const fields = schedule.cronExpr?.trim().split(/\s+/) ?? [];
  if (fields.length === 6 && fields[5] === '*') return 'daily';
  if (fields.length === 6 && /^[A-Z,]+$/.test(fields[5])) return 'weekly';
  return 'cron';
}

export function actionDraftOf(schedule: Schedule | null): ActionDraft {
  const action = parsePayload(schedule?.payload ?? '{}').actions?.[0];
  if (action?.kind === 'run-skill') return { choice: 'skill', snapshot: action };
  if (action?.kind === 'run-combo') return { choice: 'combo', snapshot: action };
  if (action?.kind === 'run-conductor') {
    return {
      choice: 'conductor',
      ticketBudget: action.ticketBudget,
      maxConcurrent: action.maxConcurrent ?? 1,
      goalId: action.goalId ?? null,
      goalName: action.goalName ?? null,
      requireReview: action.requireReview ?? false,
      judgeForm: action.judgeForm ?? null,
      judgeProviderId: action.judgeProviderId ?? null,
      judgeModel: action.judgeModel ?? null,
      // A payload saved before the launch existed — or the run-skill default —
      // opens the panel. Only an explicit `auto` may start on its own.
      launch: action.launch ?? 'dialog',
    };
  }
  if (action?.kind === 'spawn-agent') {
    return {
      choice: 'task',
      task: action.task,
      providerId: action.provider,
      model: action.model,
      permissionMode: action.permissionMode,
      launch: action.launch === 'auto' ? 'auto' : 'direct',
      headless: action.headless === true,
    };
  }
  return { choice: 'none' };
}

export function snapshotFromPin(
  pin: QuickAccessSkill,
  projectPath: string,
  launch: NotificationLaunch
): RunSkillAction {
  const snapshot: RunSkillAction = {
    id: 'run',
    label: `Start ${pin.label}`,
    kind: 'run-skill',
    skillId: pin.id,
    skillLabel: pin.label,
    prompt: pin.prompt,
    repoPath: projectPath,
    launch,
  };
  if (pin.providerId !== undefined) snapshot.providerId = pin.providerId;
  if (pin.model !== undefined) snapshot.model = pin.model;
  if (pin.permissionMode !== undefined) snapshot.permissionMode = pin.permissionMode;
  if (pin.invocation !== undefined) snapshot.invocation = pin.invocation;
  return snapshot;
}

export function snapshotFromDiscovered(
  found: ProjectSkill,
  projectPath: string,
  launch: NotificationLaunch
): RunSkillAction {
  return {
    id: 'run',
    label: `Start ${found.name}`,
    kind: 'run-skill',
    skillId: `${DISCOVERED_PREFIX}${found.invocation}`,
    skillLabel: found.name,
    prompt: found.invocation,
    repoPath: projectPath,
    invocation: found.invocation,
    launch,
  };
}

/**
 * Puts one set of launch choices onto a skill snapshot, absences included.
 *
 * Deleting rather than assigning `undefined` matters: the snapshot is compared
 * and stored as data, and a key that is present-but-empty would claim a choice
 * that was never made.
 */
export function withLaunchPins(snapshot: RunSkillAction, pins: SkillLaunchPins): RunSkillAction {
  const next: RunSkillAction = { ...snapshot };
  delete next.providerId;
  delete next.model;
  delete next.permissionMode;
  if (pins.providerId !== undefined) next.providerId = pins.providerId;
  if (pins.model !== undefined) next.model = pins.model;
  if (pins.permissionMode !== undefined) next.permissionMode = pins.permissionMode;
  return next;
}

export function launchPinsOf(snapshot: RunSkillAction | undefined): SkillLaunchPins {
  return {
    providerId: snapshot?.providerId,
    model: snapshot?.model,
    permissionMode: snapshot?.permissionMode,
  };
}

export function snapshotFromCombo(combo: QuickAccessCombo, projectPath: string): RunComboAction {
  return {
    id: 'run',
    label: `Start ${combo.label}`,
    kind: 'run-combo',
    comboId: combo.id,
    comboLabel: combo.label,
    repoPath: projectPath,
    steps: combo.steps,
  };
}

export function findLiveSkill(
  pins: QuickAccessSkill[],
  snapshot: RunSkillAction
): QuickAccessSkill | undefined {
  return (
    pins.find((pin) => pin.id === snapshot.skillId) ??
    (snapshot.invocation ? pins.find((pin) => pin.invocation === snapshot.invocation) : undefined)
  );
}

/**
 * Whether the pinned skill has moved out from under the reminder.
 *
 * Only what the reminder does not own is compared. Provider, model and
 * permission are chosen in this form and belong to the reminder from then on —
 * flagging a pin that names a different model would report a deliberate choice
 * as drift, and the fix on offer would throw that choice away.
 */
export function skillSnapshotStale(snapshot: RunSkillAction, live: QuickAccessSkill): boolean {
  return (
    snapshot.skillLabel !== live.label ||
    snapshot.prompt !== live.prompt ||
    snapshot.invocation !== live.invocation
  );
}

export function comboSnapshotStale(snapshot: RunComboAction, live: QuickAccessCombo): boolean {
  if (snapshot.comboLabel !== live.label) return true;
  if (snapshot.steps.length !== live.steps.length) return true;
  return snapshot.steps.some((step, index) => {
    const liveStep = live.steps[index];
    return (
      liveStep === undefined ||
      step.id !== liveStep.id ||
      step.label !== liveStep.label ||
      step.prompt !== liveStep.prompt ||
      step.providerId !== liveStep.providerId ||
      step.model !== liveStep.model ||
      step.permissionMode !== liveStep.permissionMode
    );
  });
}

export function actionsFromDraft(
  draft: ActionDraft,
  projectPath: string | null,
  note: string
): NotificationAction[] {
  if (draft.choice === 'none') return [];
  if (draft.choice === 'task') {
    const task = draft.task.trim();
    if (task === '') return [];
    const extra = note.trim();
    return [
      {
        id: 'run',
        label: 'Start agent',
        kind: 'spawn-agent',
        task,
        // The Note field is also inbox copy (`payload.body`). The prompt
        // reads `note` on the action, so catch-up text that later rewrites
        // the notification body cannot become part of what the agent runs.
        ...(extra !== '' ? { note: extra } : {}),
        ...(projectPath !== null ? { repoPath: projectPath } : {}),
        // Written only where a choice was made. An absent field means "same as
        // my last launch", which is what the button did before it could be
        // configured at all.
        ...(draft.providerId ? { provider: draft.providerId } : {}),
        ...(draft.providerId && draft.model ? { model: draft.model } : {}),
        ...(draft.providerId && draft.permissionMode
          ? { permissionMode: draft.permissionMode }
          : {}),
        ...(draft.launch === 'auto' ? { launch: 'auto' as const } : {}),
        ...(draft.launch === 'auto'
          ? { headless: draft.headless !== false }
          : draft.headless === true
            ? { headless: true }
            : {}),
      },
    ];
  }
  if (draft.choice === 'skill') {
    if (draft.snapshot === undefined || projectPath === null) return [];
    return [{ ...draft.snapshot, repoPath: projectPath }];
  }
  if (draft.choice === 'conductor') {
    if (projectPath === null) return [];
    const action: RunConductorAction = {
      id: 'run',
      label: 'Start conductor',
      kind: 'run-conductor',
      repoPath: projectPath,
      ticketBudget: draft.ticketBudget,
      maxConcurrent: draft.maxConcurrent,
      launch: draft.launch,
    };
    if (draft.goalId !== null) action.goalId = draft.goalId;
    if (draft.goalName !== null) action.goalName = draft.goalName;
    if (draft.requireReview) action.requireReview = true;
    // Only written when review is on and something was actually chosen: an
    // absent field is what lets the project's own judge settings stand.
    if (draft.requireReview) {
      if (draft.judgeForm !== null) action.judgeForm = draft.judgeForm;
      if (draft.judgeForm === 'agent' && draft.judgeProviderId !== null) {
        action.judgeProviderId = draft.judgeProviderId;
      }
      if (draft.judgeForm === 'agent' && draft.judgeModel !== null) {
        action.judgeModel = draft.judgeModel;
      }
    }
    return [action];
  }
  if (draft.snapshot === undefined || projectPath === null) return [];
  return [{ ...draft.snapshot, repoPath: projectPath }];
}

export function saveBlocked(name: string, draft: ActionDraft): boolean {
  if (name.trim() === '') return true;
  if (draft.choice === 'skill' && draft.snapshot === undefined) return true;
  if (draft.choice === 'combo' && draft.snapshot === undefined) return true;
  if (draft.choice === 'conductor' && draft.ticketBudget < 1) return true;
  return false;
}

export function pinnedInvocationsOf(pins: QuickAccessSkill[]): Set<string> {
  const invocations = new Set<string>();
  for (const pin of pins) {
    if (pin.invocation) invocations.add(pin.invocation);
  }
  return invocations;
}

export function visibleSkillIds(pins: QuickAccessSkill[], discovered: ProjectSkill[]): Set<string> {
  const ids = new Set(pins.map((pin) => pin.id));
  const pinned = pinnedInvocationsOf(pins);
  for (const skill of discovered) {
    if (!pinned.has(skill.invocation)) ids.add(`${DISCOVERED_PREFIX}${skill.invocation}`);
  }
  return ids;
}

export interface BuildScheduleDraftParams {
  schedule: Schedule | null;
  name: string;
  body: string;
  projectPath: string | null;
  projectName: string | null;
  actionDraft: ActionDraft;
  rhythm: RhythmChoice;
  time: string;
  weekdays: string[];
  everyN: number;
  everyUnit: 'hour' | 'day' | 'week';
  cronExpr: string;
  catchUp: ScheduleCatchUp;
}

export function buildScheduleDraft({
  schedule,
  name,
  body,
  projectPath,
  projectName,
  actionDraft,
  rhythm,
  time,
  weekdays,
  everyN,
  everyUnit,
  cronExpr,
  catchUp,
}: BuildScheduleDraftParams): Schedule {
  const payload: SchedulePayload = {
    title: name.trim() || 'Reminder',
    body: body.trim() || undefined,
    severity: 'info',
    actions: actionsFromDraft(actionDraft, projectPath, body),
  };

  const base = {
    id: schedule?.id ?? crypto.randomUUID(),
    name: name.trim() || 'Reminder',
    enabled: schedule?.enabled ?? true,
    projectPath,
    projectName,
    timezone: schedule?.timezone ?? localTimezone(),
    catchUp,
    payload: JSON.stringify(payload),
    lastFiredAt: schedule?.lastFiredAt ?? null,
    lastCheckedAt: schedule?.lastCheckedAt ?? null,
    nextDueAt: schedule?.nextDueAt ?? null,
    createdAt: schedule?.createdAt ?? '',
    updatedAt: schedule?.updatedAt ?? '',
  };

  if (rhythm === 'interval') {
    return {
      ...base,
      specKind: 'every',
      cronExpr: null,
      everyN,
      everyUnit,
      anchorAt:
        schedule?.anchorAt !== undefined &&
        schedule?.anchorAt !== null &&
        UTC_TS.test(schedule.anchorAt)
          ? schedule.anchorAt
          : anchorFor(time),
      timeOfDay: everyUnit === 'hour' ? null : time,
    };
  }

  return {
    ...base,
    specKind: 'cron',
    cronExpr:
      rhythm === 'daily'
        ? dailyCron(time)
        : rhythm === 'weekly'
          ? weeklyCron(weekdays, time)
          : cronExpr,
    everyN: null,
    everyUnit: null,
    anchorAt: null,
    timeOfDay: null,
  };
}

export function resolveProjectName({
  projectPath,
  projectOptions,
  schedule,
  defaultProjectPath,
  defaultProjectName,
}: {
  projectPath: string | null;
  projectOptions: ProjectPickerOption[];
  schedule: Schedule | null;
  defaultProjectPath: string | null;
  defaultProjectName: string | null;
}): string | null {
  if (projectPath === null) return null;
  return (
    projectOptions.find((option) => option.path === projectPath)?.name ??
    (schedule?.projectPath === projectPath ? schedule.projectName : null) ??
    (defaultProjectPath === projectPath ? defaultProjectName : null) ??
    projectPath.split('/').filter(Boolean).pop() ??
    projectPath
  );
}
