'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import {
  CATCH_UP_HINTS,
  CATCH_UP_LABELS,
  dailyCron,
  weeklyCron,
  WEEKDAY_OPTIONS,
} from '@/lib/notifications/scheduleFormat';
import type { NotificationAction } from '@/lib/notifications/types';
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
  /** Project the new schedule belongs to; null means app-wide. */
  defaultProjectPath: string | null;
  defaultProjectName: string | null;
  /** Formatted next occurrences for the draft, from the backend. */
  preview: string[];
  starredProjects: StarredProject[];
  discoveredSkills: ProjectSkill[];
  onDraftChange: (draft: Schedule) => void;
  onSave: (draft: Schedule) => void;
  onCancel: () => void;
}

type RunSkillAction = Extract<NotificationAction, { kind: 'run-skill' }>;
type RunComboAction = Extract<NotificationAction, { kind: 'run-combo' }>;

type ActionDraft =
  | { choice: 'none' }
  | { choice: 'task'; task: string }
  | { choice: 'skill'; snapshot?: RunSkillAction }
  | { choice: 'combo'; snapshot?: RunComboAction };

const DISCOVERED_PREFIX = 'discovered:';

/** Same grouping Quick Access settings already uses. */
const SCOPE_ORDER: { scope: ProjectSkillScope; title: string }[] = [
  { scope: 'project', title: 'In this project' },
  { scope: 'user', title: 'Your skills' },
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
  if (action?.kind === 'spawn-agent') return { choice: 'task', task: action.task };
  return { choice: 'none' };
}

function snapshotFromPin(pin: QuickAccessSkill, projectPath: string): RunSkillAction {
  const snapshot: RunSkillAction = {
    id: 'run',
    label: `Start ${pin.label}`,
    kind: 'run-skill',
    skillId: pin.id,
    skillLabel: pin.label,
    prompt: pin.prompt,
    repoPath: projectPath,
  };
  if (pin.providerId !== undefined) snapshot.providerId = pin.providerId;
  if (pin.model !== undefined) snapshot.model = pin.model;
  if (pin.permissionMode !== undefined) snapshot.permissionMode = pin.permissionMode;
  if (pin.invocation !== undefined) snapshot.invocation = pin.invocation;
  return snapshot;
}

function snapshotFromDiscovered(found: ProjectSkill, projectPath: string): RunSkillAction {
  return {
    id: 'run',
    label: `Start ${found.name}`,
    kind: 'run-skill',
    skillId: `${DISCOVERED_PREFIX}${found.invocation}`,
    skillLabel: found.name,
    prompt: found.invocation,
    repoPath: projectPath,
    invocation: found.invocation,
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

function skillSnapshotStale(snapshot: RunSkillAction, live: QuickAccessSkill): boolean {
  return (
    snapshot.skillLabel !== live.label ||
    snapshot.prompt !== live.prompt ||
    snapshot.providerId !== live.providerId ||
    snapshot.model !== live.model ||
    snapshot.permissionMode !== live.permissionMode ||
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

function actionsFromDraft(draft: ActionDraft, projectPath: string | null): NotificationAction[] {
  if (draft.choice === 'none') return [];
  if (draft.choice === 'task') {
    const task = draft.task.trim();
    if (task === '') return [];
    return [
      {
        id: 'run',
        label: 'Start agent',
        kind: 'spawn-agent',
        task,
        ...(projectPath !== null ? { repoPath: projectPath } : {}),
      },
    ];
  }
  if (draft.choice === 'skill') {
    if (draft.snapshot === undefined || projectPath === null) return [];
    return [{ ...draft.snapshot, repoPath: projectPath }];
  }
  if (draft.snapshot === undefined || projectPath === null) return [];
  return [{ ...draft.snapshot, repoPath: projectPath }];
}

function saveBlocked(name: string, draft: ActionDraft): boolean {
  if (name.trim() === '') return true;
  if (draft.choice === 'skill' && draft.snapshot === undefined) return true;
  if (draft.choice === 'combo' && draft.snapshot === undefined) return true;
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
  discoveredSkills,
  onDraftChange,
  onSave,
  onCancel,
}: ScheduleEditorProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({ id: 'schedule-editor', kind: 'tool', active: true, onEscape: onCancel });

  // Stored null is app-wide, not "use the open project". `??` would rewrite it.
  const projectPath = schedule === null ? defaultProjectPath : schedule.projectPath;
  const projectName = schedule === null ? defaultProjectName : schedule.projectName;

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

  const starred =
    projectPath === null ? undefined : starredProjects.find((p) => p.path === projectPath);
  const pins = starred ? quickAccessSkills(starred) : [];
  const combos = starred ? quickAccessCombos(starred) : [];
  const unpinnedDiscovered = discoveredSkills.filter(
    (skill) => !pinnedInvocationsOf(pins).has(skill.invocation)
  );
  const noQuickAccess =
    projectPath !== null && starred === undefined && discoveredSkills.length === 0;

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
      actions: actionsFromDraft(actionDraft, projectPath),
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

  const toggleWeekday = (value: string) =>
    setWeekdays((current) =>
      current.includes(value) ? current.filter((day) => day !== value) : [...current, value]
    );

  const choose = (choice: ActionDraft['choice']) => {
    if ((choice === 'skill' || choice === 'combo') && projectPath === null) return;
    setActionDraft((current) => {
      if (current.choice === choice) return current;
      if (choice === 'none') return { choice: 'none' };
      if (choice === 'task') return { choice: 'task', task: '' };
      return { choice };
    });
  };

  const selectSkill = (value: string) => {
    if (projectPath === null) return;
    if (value === '') {
      setActionDraft({ choice: 'skill' });
      return;
    }
    const pin = pins.find((item) => item.id === value);
    if (pin) {
      setActionDraft({ choice: 'skill', snapshot: snapshotFromPin(pin, projectPath) });
      return;
    }
    if (value.startsWith(DISCOVERED_PREFIX)) {
      const invocation = value.slice(DISCOVERED_PREFIX.length);
      const found = discoveredSkills.find((skill) => skill.invocation === invocation);
      if (found) {
        setActionDraft({
          choice: 'skill',
          snapshot: snapshotFromDiscovered(found, projectPath),
        });
      }
    }
  };

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

  const refreshSkillSnapshot = () => {
    if (projectPath === null || liveSkill === undefined) return;
    setActionDraft({ choice: 'skill', snapshot: snapshotFromPin(liveSkill, projectPath) });
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
              Skill and Combo need a project.
            </p>
          )}
          <p className="mt-1 text-[9px] text-foreground-muted/60">
            Offered as a button. Nothing runs without your click.
          </p>

          {actionDraft.choice === 'task' && (
            <input
              data-testid="schedule-task"
              value={actionDraft.task}
              onChange={(event) => setActionDraft({ choice: 'task', task: event.target.value })}
              placeholder="Run a server scan"
              className={`${INPUT} mt-2`}
            />
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
        </fieldset>

        <Field label="Note">
          <input
            data-testid="schedule-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Optional extra text"
            className={INPUT}
          />
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
}: {
  testId: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-[11px] ${
        disabled ? 'cursor-not-allowed text-foreground-muted/50' : 'text-foreground'
      }`}
    >
      <input
        type="radio"
        name="schedule-action"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      {label}
    </label>
  );
}
