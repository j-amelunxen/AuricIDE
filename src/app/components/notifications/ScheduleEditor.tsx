'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import {
  CATCH_UP_HINTS,
  CATCH_UP_LABELS,
  dailyCron,
  weeklyCron,
  WEEKDAY_OPTIONS,
} from '@/lib/notifications/scheduleFormat';
import type { ProjectPickerOption } from '@/lib/projects/projectOptions';
import type { SkillLaunchPins } from '@/lib/agents/skillLaunch';
import type {
  ConductorLaunch,
  NotificationAction,
  NotificationLaunch,
} from '@/lib/notifications/types';
import type { PermissionMode } from '@/lib/tauri/agents';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { goalsLoad } from '@/lib/tauri/goals';
import type { PmGoal } from '@/lib/tauri/goals';
import { comboPreview } from '@/lib/quickAccess/combo';
import {
  quickAccessCombos,
  quickAccessSkills,
  type QuickAccessCombo,
  type QuickAccessSkill,
  type StarredProject,
} from '@/lib/store/starredProjectsSlice';
import type { ProjectSkill, ProjectSkillScope } from '@/lib/tauri/projectSkills';
import type { Schedule, ScheduleCatchUp, SchedulePayload } from '@/lib/tauri/schedules';

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

type RunSkillAction = Extract<NotificationAction, { kind: 'run-skill' }>;
type RunComboAction = Extract<NotificationAction, { kind: 'run-combo' }>;
type RunConductorAction = Extract<NotificationAction, { kind: 'run-conductor' }>;

/**
 * The custom-agent launch, as far as this form owns it. Everything is optional
 * and an empty provider means "whatever I launched last" — the remembered
 * defaults stay reachable, so configuring nothing keeps working exactly as it
 * did. A model or a permission mode without a provider is not offered: both
 * only mean something relative to one harness.
 *
 * A skill's launch is the same three values in the same shape — the one both
 * the notification's Start button and a combo step resolve through.
 */
type TaskLaunchDraft = SkillLaunchPins;

/**
 * The conductor's run parameters. Unlike a skill or combo, nothing here names
 * something that lives outside this form — there is no live pin to fall out of
 * sync with — so the draft carries the values directly rather than through a
 * snapshot.
 */
type ConductorActionDraft = {
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

const DEFAULT_CONDUCTOR_DRAFT: ConductorActionDraft = {
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

type ActionDraft =
  | { choice: 'none' }
  | ({ choice: 'task'; task: string } & TaskLaunchDraft)
  | { choice: 'skill'; snapshot?: RunSkillAction }
  | { choice: 'combo'; snapshot?: RunComboAction }
  | ConductorActionDraft;

const DISCOVERED_PREFIX = 'discovered:';

function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Same grouping Quick Access settings already uses. */
const SCOPE_ORDER: { scope: ProjectSkillScope; title: string }[] = [
  { scope: 'project', title: 'In this project' },
  { scope: 'user', title: 'Your skills' },
];

/** Pinned projects lead the picker; everything else follows under one heading. */
const PROJECT_GROUPS: { starred: boolean; title: string }[] = [
  { starred: true, title: 'Quick Access' },
  { starred: false, title: 'Recent' },
];

const UTC_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Today at the given local wall-clock time, as a UTC timestamp. */
function anchorFor(time: string): string {
  const [hour = '9', minute = '0'] = time.split(':');
  const local = new Date();
  local.setHours(Number(hour), Number(minute), 0, 0);
  return local.toISOString().replace('T', ' ').slice(0, 19);
}

function parsePayload(raw: string): SchedulePayload {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as SchedulePayload) : {};
  } catch {
    return {};
  }
}

function rhythmOf(schedule: Schedule | null): RhythmChoice {
  if (schedule === null) return 'weekly';
  if (schedule.specKind === 'every') return 'interval';
  const fields = schedule.cronExpr?.trim().split(/\s+/) ?? [];
  if (fields.length === 6 && fields[5] === '*') return 'daily';
  if (fields.length === 6 && /^[A-Z,]+$/.test(fields[5])) return 'weekly';
  return 'cron';
}

function actionDraftOf(schedule: Schedule | null): ActionDraft {
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
    };
  }
  return { choice: 'none' };
}

function snapshotFromPin(
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

function snapshotFromDiscovered(
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
function withLaunchPins(snapshot: RunSkillAction, pins: SkillLaunchPins): RunSkillAction {
  const next: RunSkillAction = { ...snapshot };
  delete next.providerId;
  delete next.model;
  delete next.permissionMode;
  if (pins.providerId !== undefined) next.providerId = pins.providerId;
  if (pins.model !== undefined) next.model = pins.model;
  if (pins.permissionMode !== undefined) next.permissionMode = pins.permissionMode;
  return next;
}

function launchPinsOf(snapshot: RunSkillAction | undefined): SkillLaunchPins {
  return {
    providerId: snapshot?.providerId,
    model: snapshot?.model,
    permissionMode: snapshot?.permissionMode,
  };
}

function snapshotFromCombo(combo: QuickAccessCombo, projectPath: string): RunComboAction {
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

function findLiveSkill(
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
function skillSnapshotStale(snapshot: RunSkillAction, live: QuickAccessSkill): boolean {
  return (
    snapshot.skillLabel !== live.label ||
    snapshot.prompt !== live.prompt ||
    snapshot.invocation !== live.invocation
  );
}

function comboSnapshotStale(snapshot: RunComboAction, live: QuickAccessCombo): boolean {
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

function actionsFromDraft(
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

function saveBlocked(name: string, draft: ActionDraft): boolean {
  if (name.trim() === '') return true;
  if (draft.choice === 'skill' && draft.snapshot === undefined) return true;
  if (draft.choice === 'combo' && draft.snapshot === undefined) return true;
  if (draft.choice === 'conductor' && draft.ticketBudget < 1) return true;
  return false;
}

function pinnedInvocationsOf(pins: QuickAccessSkill[]): Set<string> {
  const invocations = new Set<string>();
  for (const pin of pins) {
    if (pin.invocation) invocations.add(pin.invocation);
  }
  return invocations;
}

function visibleSkillIds(pins: QuickAccessSkill[], discovered: ProjectSkill[]): Set<string> {
  const ids = new Set(pins.map((pin) => pin.id));
  const pinned = pinnedInvocationsOf(pins);
  for (const skill of discovered) {
    if (!pinned.has(skill.invocation)) ids.add(`${DISCOVERED_PREFIX}${skill.invocation}`);
  }
  return ids;
}

/**
 * The form for one reminder.
 *
 * It shows the next three occurrences as you type. That preview is not a nicety:
 * a rhythm that is subtly wrong — the wrong weekday, an interval anchored a day
 * off — is otherwise only discovered three weeks later, when the reminder you
 * were relying on does not arrive.
 */
export function ScheduleEditor({
  schedule,
  defaultProjectPath,
  defaultProjectName,
  preview,
  starredProjects,
  projectOptions,
  discoveredSkills,
  providers,
  onDraftChange,
  onSave,
  onCancel,
}: ScheduleEditorProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({ id: 'schedule-editor', kind: 'tool', active: true, onEscape: onCancel });

  // Stored null is app-wide, not "use the open project". `??` would rewrite it.
  const [projectPath, setProjectPath] = useState<string | null>(
    schedule === null ? defaultProjectPath : schedule.projectPath
  );
  const projectName =
    projectPath === null
      ? null
      : (projectOptions.find((option) => option.path === projectPath)?.name ??
        (schedule?.projectPath === projectPath ? schedule.projectName : null) ??
        (defaultProjectPath === projectPath ? defaultProjectName : null) ??
        projectPath.split('/').filter(Boolean).pop() ??
        projectPath);

  const [name, setName] = useState(schedule?.name ?? '');
  const [rhythm, setRhythm] = useState<RhythmChoice>(() => rhythmOf(schedule));
  const [time, setTime] = useState(schedule?.timeOfDay ?? '09:00');
  const [weekdays, setWeekdays] = useState<string[]>(() => {
    const fields = schedule?.cronExpr?.trim().split(/\s+/) ?? [];
    return fields.length === 6 && /^[A-Z,]+$/.test(fields[5]) ? fields[5].split(',') : ['WED'];
  });
  const [everyN, setEveryN] = useState(schedule?.everyN ?? 14);
  const [everyUnit, setEveryUnit] = useState(schedule?.everyUnit ?? 'day');
  const [cronExpr, setCronExpr] = useState(schedule?.cronExpr ?? '0 0 9 * * MON');
  const [catchUp, setCatchUp] = useState<ScheduleCatchUp>(schedule?.catchUp ?? 'coalesce');
  const [actionDraft, setActionDraft] = useState<ActionDraft>(() => actionDraftOf(schedule));
  const [body, setBody] = useState(() => parsePayload(schedule?.payload ?? '{}').body ?? '');
  const [conductorGoals, setConductorGoals] = useState<PmGoal[]>([]);
  const [conductorGoalsLoading, setConductorGoalsLoading] = useState(false);

  const selectedProject =
    projectPath === null ? undefined : projectOptions.find((option) => option.path === projectPath);
  const starred =
    projectPath === null ? undefined : starredProjects.find((p) => p.path === projectPath);
  const pins = starred ? quickAccessSkills(starred) : [];
  const combos = starred ? quickAccessCombos(starred) : [];
  const unpinnedDiscovered = discoveredSkills.filter(
    (skill) => !pinnedInvocationsOf(pins).has(skill.invocation)
  );
  const noQuickAccess =
    projectPath !== null && starred === undefined && discoveredSkills.length === 0;

  /**
   * Anything picked from now on starts on the click; a schedule saved before
   * that was possible says nothing, and keeps stopping at the dialog until it
   * is told otherwise here.
   */
  const skillLaunch: NotificationLaunch =
    actionDraft.choice === 'skill' && actionDraft.snapshot !== undefined
      ? (actionDraft.snapshot.launch ?? 'dialog')
      : 'direct';

  const taskProvider =
    actionDraft.choice === 'task' && actionDraft.providerId
      ? providers.find((provider) => provider.id === actionDraft.providerId)
      : undefined;

  const skillProvider =
    actionDraft.choice === 'skill' && actionDraft.snapshot?.providerId
      ? providers.find((provider) => provider.id === actionDraft.snapshot?.providerId)
      : undefined;

  // Only a named judge provider has models to offer: "same as the conductor"
  // is resolved at run time against the project, which this form cannot read.
  const judgeProvider =
    actionDraft.choice === 'conductor' && actionDraft.judgeProviderId
      ? providers.find((provider) => provider.id === actionDraft.judgeProviderId)
      : undefined;

  const liveSkill =
    actionDraft.choice === 'skill' && actionDraft.snapshot
      ? findLiveSkill(pins, actionDraft.snapshot)
      : undefined;
  const skillStale =
    actionDraft.choice === 'skill' &&
    actionDraft.snapshot !== undefined &&
    liveSkill !== undefined &&
    skillSnapshotStale(actionDraft.snapshot, liveSkill);

  const liveCombo =
    actionDraft.choice === 'combo' && actionDraft.snapshot
      ? combos.find((combo) => combo.id === actionDraft.snapshot?.comboId)
      : undefined;
  const comboStale =
    actionDraft.choice === 'combo' &&
    actionDraft.snapshot !== undefined &&
    liveCombo !== undefined &&
    comboSnapshotStale(actionDraft.snapshot, liveCombo);

  const orphanSkill =
    actionDraft.choice === 'skill' &&
    actionDraft.snapshot !== undefined &&
    !visibleSkillIds(pins, discoveredSkills).has(actionDraft.snapshot.skillId)
      ? actionDraft.snapshot
      : undefined;
  const orphanCombo =
    actionDraft.choice === 'combo' &&
    actionDraft.snapshot !== undefined &&
    !combos.some((combo) => combo.id === actionDraft.snapshot?.comboId)
      ? actionDraft.snapshot
      : undefined;

  const draft = useMemo<Schedule>(() => {
    const payload: SchedulePayload = {
      title: name.trim() || 'Reminder',
      body: body.trim() || undefined,
      severity: 'info',
      // The only action a schedule offers is the one you asked for. It is a
      // button, never an automatic launch.
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
  }, [
    actionDraft,
    body,
    catchUp,
    cronExpr,
    everyN,
    everyUnit,
    name,
    projectName,
    projectPath,
    rhythm,
    schedule,
    time,
    weekdays,
  ]);

  useEffect(() => {
    onDraftChange(draft);
  }, [draft, onDraftChange]);

  /**
   * The goal picker is scoped to whichever project the conductor would run
   * against, read fresh whenever that project changes. Gated on the conductor
   * being the current choice so every other schedule kind — the common case —
   * never opens this project's database at all.
   */
  useEffect(() => {
    if (actionDraft.choice !== 'conductor' || projectPath === null) return;
    const path = projectPath;
    let cancelled = false;

    async function loadGoals() {
      setConductorGoalsLoading(true);
      try {
        const state = await goalsLoad(path);
        if (cancelled) return;
        setConductorGoals(
          state.goals.filter((goal) => goal.status !== 'achieved' && goal.status !== 'archived')
        );
      } catch {
        // Browser mode, or a project with no database yet: the run simply
        // scopes to all tickets, same as if the field were left untouched.
        if (cancelled) return;
        setConductorGoals([]);
      } finally {
        if (!cancelled) setConductorGoalsLoading(false);
      }
    }

    void loadGoals();
    return () => {
      cancelled = true;
    };
  }, [actionDraft.choice, projectPath]);

  const toggleWeekday = (value: string) =>
    setWeekdays((current) =>
      current.includes(value) ? current.filter((day) => day !== value) : [...current, value]
    );

  /**
   * A skill or combo snapshot names something inside one specific project.
   * Carrying it across would keep the old label and prompt while pointing the
   * run at a different repository — so the selection is dropped and has to be
   * made again from the new project's catalogue. `saveBlocked` holds the save
   * until it is.
   */
  const chooseProject = (value: string) => {
    const next = value === '' ? null : value;
    setProjectPath(next);
    setActionDraft((current) => {
      if (current.choice === 'skill' || current.choice === 'combo') {
        return next === null ? { choice: 'none' } : { choice: current.choice };
      }
      if (current.choice === 'conductor') {
        // Budget, concurrency, review and launch belong to this reminder, not
        // to the project — only the goal, which names a row in one project's
        // own database, has to be re-picked.
        return next === null ? { choice: 'none' } : { ...current, goalId: null, goalName: null };
      }
      return current;
    });
  };

  const choose = (choice: ActionDraft['choice']) => {
    if (
      (choice === 'skill' || choice === 'combo' || choice === 'conductor') &&
      projectPath === null
    )
      return;
    setActionDraft((current) => {
      if (current.choice === choice) return current;
      if (choice === 'none') return { choice: 'none' };
      if (choice === 'task') return { choice: 'task', task: '' };
      if (choice === 'conductor') return { ...DEFAULT_CONDUCTOR_DRAFT };
      return { choice };
    });
  };

  const setConductorDraft = (patch: Partial<ConductorActionDraft>) =>
    setActionDraft((current) =>
      current.choice === 'conductor' ? { ...current, ...patch } : current
    );

  const selectConductorGoal = (value: string) => {
    if (value === '') {
      setConductorDraft({ goalId: null, goalName: null });
      return;
    }
    const goal = conductorGoals.find((candidate) => candidate.id === value);
    setConductorDraft({ goalId: value, goalName: goal?.name ?? null });
  };

  /**
   * A skill picked here starts on the click. That is the whole point of
   * configuring the launch in advance — and it is still one click by a human,
   * on a button they wrote themselves. `setSkillLaunch` puts the dialog back
   * for anyone who wants to look before it runs.
   */
  const selectSkill = (value: string) => {
    if (projectPath === null) return;
    if (value === '') {
      setActionDraft({ choice: 'skill' });
      return;
    }
    const launch = actionDraft.choice === 'skill' ? skillLaunch : 'direct';
    const pin = pins.find((item) => item.id === value);
    if (pin) {
      setActionDraft({ choice: 'skill', snapshot: snapshotFromPin(pin, projectPath, launch) });
      return;
    }
    if (value.startsWith(DISCOVERED_PREFIX)) {
      const invocation = value.slice(DISCOVERED_PREFIX.length);
      const found = discoveredSkills.find((skill) => skill.invocation === invocation);
      if (found) {
        setActionDraft({
          choice: 'skill',
          snapshot: snapshotFromDiscovered(found, projectPath, launch),
        });
      }
    }
  };

  const setSkillLaunch = (direct: boolean) => {
    setActionDraft((current) =>
      current.choice === 'skill' && current.snapshot !== undefined
        ? {
            choice: 'skill',
            snapshot: { ...current.snapshot, launch: direct ? 'direct' : 'dialog' },
          }
        : current
    );
  };

  const setTaskLaunch = (patch: TaskLaunchDraft) => {
    setActionDraft((current) => (current.choice === 'task' ? { ...current, ...patch } : current));
  };

  /**
   * Changing the harness drops the model and the permission mode with it —
   * both name something inside the provider they were picked for, and left
   * standing they would be silently replaced at launch anyway.
   */
  const chooseTaskProvider = (providerId: string) =>
    setTaskLaunch(
      providerId === ''
        ? { providerId: undefined, model: undefined, permissionMode: undefined }
        : { providerId, model: undefined, permissionMode: undefined }
    );

  const setSkillPins = (patch: SkillLaunchPins) =>
    setActionDraft((current) =>
      current.choice === 'skill' && current.snapshot !== undefined
        ? {
            choice: 'skill',
            snapshot: withLaunchPins(current.snapshot, {
              ...launchPinsOf(current.snapshot),
              ...patch,
            }),
          }
        : current
    );

  /** Same rule as the custom agent: the harness carries its own two fields. */
  const chooseSkillProvider = (providerId: string) =>
    setSkillPins(
      providerId === ''
        ? { providerId: undefined, model: undefined, permissionMode: undefined }
        : { providerId, model: undefined, permissionMode: undefined }
    );

  const selectCombo = (value: string) => {
    if (projectPath === null) return;
    if (value === '') {
      setActionDraft({ choice: 'combo' });
      return;
    }
    const combo = combos.find((item) => item.id === value);
    if (combo) {
      setActionDraft({ choice: 'combo', snapshot: snapshotFromCombo(combo, projectPath) });
    }
  };

  /**
   * Takes the pin's wording over, and only its wording. The launch was decided
   * here and stays decided — a drifted prompt is no reason to start the run on
   * a different agent than the one the reminder says it uses.
   */
  const refreshSkillSnapshot = () => {
    if (projectPath === null || liveSkill === undefined) return;
    setActionDraft((current) => ({
      choice: 'skill',
      snapshot: withLaunchPins(
        snapshotFromPin(liveSkill, projectPath, skillLaunch),
        launchPinsOf(current.choice === 'skill' ? current.snapshot : undefined)
      ),
    }));
  };

  const refreshComboSnapshot = () => {
    if (projectPath === null || liveCombo === undefined) return;
    setActionDraft({ choice: 'combo', snapshot: snapshotFromCombo(liveCombo, projectPath) });
  };

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-tool-nested)] flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-editor-title"
        className="w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-panel-bg p-4 shadow-2xl"
        style={{ maxHeight: '85vh' }}
      >
        <h2
          id="schedule-editor-title"
          className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-foreground-muted"
        >
          {schedule === null ? 'New schedule' : 'Edit schedule'}
        </h2>

        <Field label="Name">
          <input
            data-testid="schedule-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Security-Scan"
            className={INPUT}
          />
        </Field>

        <Field label="Project">
          <div className="flex items-center gap-2">
            {projectPath !== null && (
              <ProjectTileFace
                path={projectPath}
                icon={selectedProject?.icon}
                size="sm"
                className="flex-shrink-0"
              />
            )}
            <select
              data-testid="schedule-project"
              value={projectPath ?? ''}
              onChange={(event) => chooseProject(event.target.value)}
              className={INPUT}
            >
              <option value="">App-wide — no project</option>
              {PROJECT_GROUPS.map(({ starred, title }) => {
                const entries = projectOptions.filter((option) => option.starred === starred);
                if (entries.length === 0) return null;
                return (
                  <optgroup key={title} label={title}>
                    {entries.map((option) => (
                      <option key={option.path} value={option.path}>
                        {option.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
          <p className="mt-1 text-[9px] text-foreground-muted/60">
            Decides which skills the reminder can offer, and where they run.
          </p>
        </Field>

        <Field label="Rhythm">
          <select
            data-testid="schedule-rhythm"
            value={rhythm}
            onChange={(event) => setRhythm(event.target.value as RhythmChoice)}
            className={INPUT}
          >
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="interval">every N days / weeks / hours</option>
            <option value="cron">custom cron</option>
          </select>
        </Field>

        {rhythm === 'weekly' && (
          <Field label="Weekdays">
            <div className="flex flex-wrap gap-1">
              {WEEKDAY_OPTIONS.map((day) => (
                <button
                  key={day.value}
                  data-testid={`schedule-weekday-${day.value}`}
                  aria-pressed={weekdays.includes(day.value)}
                  onClick={() => toggleWeekday(day.value)}
                  className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors ${
                    weekdays.includes(day.value)
                      ? 'bg-primary/20 text-primary-light'
                      : 'bg-white/5 text-foreground-muted hover:bg-white/10'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </Field>
        )}

        {rhythm === 'interval' && (
          <Field label="Interval">
            <div className="flex gap-2">
              <input
                data-testid="schedule-every-n"
                type="number"
                min={1}
                value={everyN}
                onChange={(event) => setEveryN(Math.max(1, Number(event.target.value) || 1))}
                className={`${INPUT} w-20`}
              />
              <select
                data-testid="schedule-every-unit"
                value={everyUnit}
                onChange={(event) => setEveryUnit(event.target.value as 'hour' | 'day' | 'week')}
                className={INPUT}
              >
                <option value="hour">hours</option>
                <option value="day">days</option>
                <option value="week">weeks</option>
              </select>
            </div>
          </Field>
        )}

        {rhythm === 'cron' && (
          <Field label="Cron expression">
            <input
              data-testid="schedule-cron"
              value={cronExpr}
              onChange={(event) => setCronExpr(event.target.value)}
              placeholder="0 0 17 * * WED"
              className={`${INPUT} font-mono`}
            />
            <p className="mt-1 text-[9px] text-foreground-muted/60">
              Seconds first. Weekdays as names (MON, WED); numbers count differently here than in
              ordinary cron.
            </p>
          </Field>
        )}

        {(rhythm !== 'interval' || everyUnit !== 'hour') && (
          <Field label="Time">
            <input
              data-testid="schedule-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className={`${INPUT} w-32`}
            />
          </Field>
        )}

        <fieldset className="mb-2.5">
          <legend className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-foreground-muted/70">
            Action
          </legend>
          <div className="flex flex-col gap-1">
            <Choice
              testId="schedule-action-none"
              label="Reminder only"
              checked={actionDraft.choice === 'none'}
              onSelect={() => choose('none')}
            />
            <Choice
              testId="schedule-action-skill"
              label="Skill"
              checked={actionDraft.choice === 'skill'}
              disabled={projectPath === null}
              onSelect={() => choose('skill')}
            />
            <Choice
              testId="schedule-action-combo"
              label="Combo"
              checked={actionDraft.choice === 'combo'}
              disabled={projectPath === null}
              onSelect={() => choose('combo')}
            />
            <Choice
              testId="schedule-action-conductor"
              label="Conductor"
              checked={actionDraft.choice === 'conductor'}
              disabled={projectPath === null}
              onSelect={() => choose('conductor')}
            />
            <Choice
              testId="schedule-action-task"
              label="Custom agent"
              checked={actionDraft.choice === 'task'}
              onSelect={() => choose('task')}
            />
          </div>
          {projectPath === null && (
            <p
              data-testid="schedule-skill-combo-hint"
              className="mt-1 text-[9px] text-foreground-muted/60"
            >
              Skill, Combo and Conductor need a project.
            </p>
          )}
          <p className="mt-1 text-[9px] text-foreground-muted/60">
            {actionDraft.choice === 'conductor' && actionDraft.launch === 'auto'
              ? 'Starts on its own when the IDE is unattended — see the hint above.'
              : 'Offered as a button. Nothing runs without your click.'}
          </p>

          {actionDraft.choice === 'task' && (
            <div className="mt-2">
              <input
                data-testid="schedule-task"
                value={actionDraft.task}
                onChange={(event) =>
                  setActionDraft((current) =>
                    current.choice === 'task' ? { ...current, task: event.target.value } : current
                  )
                }
                placeholder="Run a server scan"
                className={INPUT}
              />

              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={SUBLABEL}>Agent</span>
                  <select
                    data-testid="schedule-task-provider"
                    value={actionDraft.providerId ?? ''}
                    onChange={(event) => chooseTaskProvider(event.target.value)}
                    className={INPUT}
                  >
                    <option value="">Same as last launch</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className={SUBLABEL}>Model</span>
                  <select
                    data-testid="schedule-task-model"
                    disabled={taskProvider === undefined}
                    value={actionDraft.model ?? ''}
                    onChange={(event) => setTaskLaunch({ model: event.target.value || undefined })}
                    className={`${INPUT} disabled:opacity-40`}
                  >
                    <option value="">{taskProvider?.defaultModel ?? 'Pick an agent first'}</option>
                    {(taskProvider?.models ?? []).map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="mt-2 block">
                <span className={SUBLABEL}>Permission</span>
                <select
                  data-testid="schedule-task-permission"
                  disabled={taskProvider === undefined}
                  value={actionDraft.permissionMode ?? ''}
                  onChange={(event) =>
                    setTaskLaunch({
                      permissionMode: (event.target.value || undefined) as PermissionMode,
                    })
                  }
                  className={`${INPUT} disabled:opacity-40`}
                >
                  <option value="">Same as last launch</option>
                  {(taskProvider?.permissionModes ?? []).map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[9px] text-foreground-muted/60">
                  How far the agent gets on its own before it stops to ask you.
                </p>
              </label>
            </div>
          )}

          {actionDraft.choice === 'skill' && projectPath !== null && (
            <div className="mt-2">
              {noQuickAccess && (
                <p className="mb-1 text-[9px] text-foreground-muted/60">
                  No Quick Access is set up for this project. Add a skill there first.
                </p>
              )}
              <select
                data-testid="schedule-skill-select"
                value={actionDraft.snapshot?.skillId ?? ''}
                onChange={(event) => selectSkill(event.target.value)}
                className={INPUT}
              >
                <option value="">Choose a skill</option>
                {orphanSkill && (
                  <option value={orphanSkill.skillId}>{orphanSkill.skillLabel} (saved)</option>
                )}
                {pins.map((pin) => (
                  <option key={pin.id} value={pin.id}>
                    {pin.label}
                  </option>
                ))}
                {SCOPE_ORDER.map(({ scope, title }) => {
                  const entries = unpinnedDiscovered.filter((skill) => skill.scope === scope);
                  if (entries.length === 0) return null;
                  return (
                    <optgroup key={scope} label={title}>
                      {entries.map((skill) => (
                        <option
                          key={skill.invocation}
                          value={`${DISCOVERED_PREFIX}${skill.invocation}`}
                        >
                          {skill.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              {actionDraft.snapshot && (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className={SUBLABEL}>Agent</span>
                      <select
                        data-testid="schedule-skill-provider"
                        value={actionDraft.snapshot.providerId ?? ''}
                        onChange={(event) => chooseSkillProvider(event.target.value)}
                        className={INPUT}
                      >
                        <option value="">Default agent</option>
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className={SUBLABEL}>Model</span>
                      <select
                        data-testid="schedule-skill-model"
                        disabled={skillProvider === undefined}
                        value={actionDraft.snapshot.model ?? ''}
                        onChange={(event) =>
                          setSkillPins({ model: event.target.value || undefined })
                        }
                        className={`${INPUT} disabled:opacity-40`}
                      >
                        <option value="">
                          {skillProvider?.defaultModel ?? 'Pick an agent first'}
                        </option>
                        {(skillProvider?.models ?? []).map((model) => (
                          <option key={model.value} value={model.value}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="mt-2 block">
                    <span className={SUBLABEL}>Permission</span>
                    <select
                      data-testid="schedule-skill-permission"
                      disabled={skillProvider === undefined}
                      value={actionDraft.snapshot.permissionMode ?? ''}
                      onChange={(event) =>
                        setSkillPins({
                          permissionMode: (event.target.value || undefined) as PermissionMode,
                        })
                      }
                      className={`${INPUT} disabled:opacity-40`}
                    >
                      <option value="">Agent default</option>
                      {(skillProvider?.permissionModes ?? []).map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[9px] text-foreground-muted/60">
                      Starts from what the skill is pinned to. Changing it here changes this
                      reminder only.
                    </p>
                  </label>

                  <label className="mt-2 flex items-start gap-2 text-[11px] text-foreground">
                    <input
                      type="checkbox"
                      data-testid="schedule-skill-direct"
                      checked={skillLaunch === 'direct'}
                      onChange={(event) => setSkillLaunch(event.target.checked)}
                      className="mt-[2px]"
                    />
                    <span>
                      Start on the click
                      <span className="mt-0.5 block text-[9px] text-foreground-muted/60">
                        {skillLaunch === 'direct'
                          ? 'Runs with the agent, model and permission chosen above.'
                          : 'Opens the spawn dialog first, pre-filled — one more click.'}
                      </span>
                    </span>
                  </label>
                </>
              )}
              {skillStale && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <p data-testid="schedule-snapshot-stale" className="text-[9px] text-[#ffce2e]">
                    The pinned skill has changed.
                  </p>
                  <button
                    type="button"
                    data-testid="schedule-snapshot-refresh"
                    onClick={refreshSkillSnapshot}
                    className="rounded-lg px-2 py-1 text-[10px] font-semibold text-primary-light hover:bg-white/10"
                  >
                    Update snapshot
                  </button>
                </div>
              )}
            </div>
          )}

          {actionDraft.choice === 'combo' && projectPath !== null && (
            <div className="mt-2">
              {noQuickAccess && (
                <p className="mb-1 text-[9px] text-foreground-muted/60">
                  No Quick Access is set up for this project. Add a combo there first.
                </p>
              )}
              <select
                data-testid="schedule-combo-select"
                value={actionDraft.snapshot?.comboId ?? ''}
                onChange={(event) => selectCombo(event.target.value)}
                className={INPUT}
              >
                <option value="">Choose a combo</option>
                {orphanCombo && (
                  <option value={orphanCombo.comboId}>{orphanCombo.comboLabel} (saved)</option>
                )}
                {combos.map((combo) => (
                  <option key={combo.id} value={combo.id}>
                    {combo.label}
                  </option>
                ))}
              </select>
              {actionDraft.snapshot && (
                <p
                  data-testid="schedule-combo-preview"
                  className="mt-1 text-[9px] text-foreground-muted/60"
                >
                  {comboPreview({
                    id: actionDraft.snapshot.comboId,
                    label: actionDraft.snapshot.comboLabel,
                    steps: actionDraft.snapshot.steps,
                  })}
                </p>
              )}
              {actionDraft.snapshot && (
                <p className="mt-1 text-[9px] text-foreground-muted/60">
                  Starts on the click and runs the steps in order, each with the provider and
                  permission it is pinned to.
                </p>
              )}
              {comboStale && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <p data-testid="schedule-snapshot-stale" className="text-[9px] text-[#ffce2e]">
                    The pinned combo has changed.
                  </p>
                  <button
                    type="button"
                    data-testid="schedule-snapshot-refresh"
                    onClick={refreshComboSnapshot}
                    className="rounded-lg px-2 py-1 text-[10px] font-semibold text-primary-light hover:bg-white/10"
                  >
                    Update snapshot
                  </button>
                </div>
              )}
            </div>
          )}

          {actionDraft.choice === 'conductor' && projectPath !== null && (
            <div className="mt-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={SUBLABEL}>Tickets per run</span>
                  <input
                    data-testid="schedule-conductor-budget"
                    type="number"
                    min={1}
                    max={50}
                    value={actionDraft.ticketBudget}
                    onChange={(event) =>
                      setConductorDraft({
                        ticketBudget: clampInt(Number(event.target.value), 1, 50),
                      })
                    }
                    className={INPUT}
                  />
                </label>

                <label className="block">
                  <span className={SUBLABEL}>In parallel</span>
                  <input
                    data-testid="schedule-conductor-concurrency"
                    type="number"
                    min={1}
                    max={8}
                    value={actionDraft.maxConcurrent}
                    onChange={(event) =>
                      setConductorDraft({
                        maxConcurrent: clampInt(Number(event.target.value), 1, 8),
                      })
                    }
                    className={INPUT}
                  />
                  <p className="mt-1 text-[9px] text-foreground-muted/60">1 = one after another</p>
                </label>
              </div>

              <label className="mt-2 block">
                <span className={SUBLABEL}>Scope</span>
                <select
                  data-testid="schedule-conductor-goal"
                  disabled={conductorGoalsLoading}
                  value={actionDraft.goalId ?? ''}
                  onChange={(event) => selectConductorGoal(event.target.value)}
                  className={`${INPUT} disabled:opacity-40`}
                >
                  <option value="">
                    {conductorGoalsLoading ? 'Loading goals…' : 'All tickets'}
                  </option>
                  {actionDraft.goalId !== null &&
                    !conductorGoals.some((goal) => goal.id === actionDraft.goalId) && (
                      <option value={actionDraft.goalId}>
                        {actionDraft.goalName ?? actionDraft.goalId} (saved)
                      </option>
                    )}
                  {conductorGoals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-2 flex items-start gap-2 text-[11px] text-foreground">
                <input
                  type="checkbox"
                  data-testid="schedule-conductor-review"
                  checked={actionDraft.requireReview}
                  onChange={(event) => setConductorDraft({ requireReview: event.target.checked })}
                  className="mt-[2px]"
                />
                <span>Judge the result</span>
              </label>

              {/* The judge's own harness. Left on "the project's setting" a
                  schedule keeps behaving like the panel's Start button, which
                  is what every schedule saved before this did. */}
              {actionDraft.requireReview && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className={SUBLABEL}>Judge via</span>
                    <select
                      data-testid="schedule-conductor-judge-form"
                      value={actionDraft.judgeForm ?? ''}
                      onChange={(event) =>
                        setConductorDraft({
                          judgeForm: (event.target.value || null) as 'llm' | 'agent' | null,
                          // A form that spawns nothing has no harness to name;
                          // keeping one would save a setting that never applies.
                          ...(event.target.value !== 'agent' && {
                            judgeProviderId: null,
                            judgeModel: null,
                          }),
                        })
                      }
                      className={INPUT}
                    >
                      <option value="">The project&apos;s setting</option>
                      <option value="llm">LLM call</option>
                      <option value="agent">Review agent</option>
                    </select>
                  </label>

                  {actionDraft.judgeForm === 'agent' && (
                    <label className="block">
                      <span className={SUBLABEL}>Judge agent</span>
                      <select
                        data-testid="schedule-conductor-judge-provider"
                        value={actionDraft.judgeProviderId ?? ''}
                        onChange={(event) =>
                          setConductorDraft({
                            judgeProviderId: event.target.value || null,
                            // The model belongs to the provider that offers it.
                            judgeModel: null,
                          })
                        }
                        className={INPUT}
                      >
                        <option value="">Same as the conductor</option>
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {actionDraft.judgeForm === 'agent' && (
                    <label className="block">
                      <span className={SUBLABEL}>Judge model</span>
                      <select
                        data-testid="schedule-conductor-judge-model"
                        disabled={judgeProvider === undefined}
                        value={actionDraft.judgeModel ?? ''}
                        onChange={(event) =>
                          setConductorDraft({ judgeModel: event.target.value || null })
                        }
                        className={`${INPUT} disabled:opacity-40`}
                      >
                        <option value="">
                          {judgeProvider === undefined
                            ? 'Pick an agent first'
                            : 'Same as the conductor'}
                        </option>
                        {(judgeProvider?.models ?? []).map((model) => (
                          <option key={model.value} value={model.value}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              <fieldset className="mt-2">
                <legend className={SUBLABEL}>Launch</legend>
                <div className="flex flex-col gap-1">
                  <Choice
                    name="schedule-conductor-launch"
                    testId="schedule-conductor-launch-auto"
                    label="Start by itself"
                    checked={actionDraft.launch === 'auto'}
                    onSelect={() => setConductorDraft({ launch: 'auto' })}
                  />
                  <Choice
                    name="schedule-conductor-launch"
                    testId="schedule-conductor-launch-direct"
                    label="Start on click"
                    checked={actionDraft.launch === 'direct'}
                    onSelect={() => setConductorDraft({ launch: 'direct' })}
                  />
                  <Choice
                    name="schedule-conductor-launch"
                    testId="schedule-conductor-launch-dialog"
                    label="Open the panel first"
                    checked={actionDraft.launch === 'dialog'}
                    onSelect={() => setConductorDraft({ launch: 'dialog' })}
                  />
                </div>
                {actionDraft.launch === 'auto' && (
                  <p
                    data-testid="schedule-conductor-auto-hint"
                    className="mt-1 text-[9px] text-foreground-muted/60"
                  >
                    Only when the IDE is idle and the timing is fresh; otherwise it waits for your
                    click.
                  </p>
                )}
              </fieldset>
            </div>
          )}
        </fieldset>

        <Field label="Note">
          <input
            data-testid="schedule-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Optional extra text"
            className={INPUT}
          />
          {actionDraft.choice === 'task' && (
            <p
              data-testid="schedule-body-prompt-hint"
              className="mt-1 text-[9px] text-foreground-muted/60"
            >
              Also added to the agent&apos;s prompt.
            </p>
          )}
        </Field>

        <Field label="If AuricIDE was closed">
          <select
            data-testid="schedule-catch-up"
            value={catchUp}
            onChange={(event) => setCatchUp(event.target.value as ScheduleCatchUp)}
            className={INPUT}
          >
            {(Object.keys(CATCH_UP_LABELS) as ScheduleCatchUp[]).map((option) => (
              <option key={option} value={option}>
                {CATCH_UP_LABELS[option]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[9px] text-foreground-muted/60">{CATCH_UP_HINTS[catchUp]}</p>
        </Field>

        <div
          data-testid="schedule-preview"
          className="mt-3 rounded-xl border border-white/5 bg-black/20 p-2.5"
        >
          <p className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-foreground-muted/60">
            <AuricIcon name="schedule" className="text-[11px]" />
            Upcoming
          </p>
          {preview.length === 0 ? (
            <p data-testid="schedule-preview-empty" className="text-[10px] text-[#ffce2e]">
              No upcoming date could be calculated. Check the schedule fields and try again.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {preview.map((entry) => (
                <li key={entry} className="font-mono text-[10px] text-foreground-muted">
                  {entry}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            data-testid="schedule-cancel"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-[11px] text-foreground-muted transition-colors hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            data-testid="schedule-save"
            onClick={() => onSave(draft)}
            disabled={saveBlocked(name, actionDraft)}
            className="rounded-lg bg-primary/20 px-3 py-1.5 text-[11px] font-bold text-primary-light transition-colors hover:bg-primary/30 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const INPUT =
  'w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/40';

const SUBLABEL =
  'mb-1 block font-mono text-[9px] uppercase tracking-wider text-foreground-muted/70';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2.5 block">
      <span className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-foreground-muted/70">
        {label}
      </span>
      {children}
    </label>
  );
}

function Choice({
  testId,
  label,
  checked,
  disabled,
  onSelect,
  name = 'schedule-action',
}: {
  testId: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** Which radio group this belongs to — the Action fieldset by default. */
  name?: string;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-[11px] ${
        disabled ? 'cursor-not-allowed text-foreground-muted/50' : 'text-foreground'
      }`}
    >
      <input
        type="radio"
        name={name}
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      {label}
    </label>
  );
}
