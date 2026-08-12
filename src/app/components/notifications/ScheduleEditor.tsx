'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import {
  CATCH_UP_HINTS,
  CATCH_UP_LABELS,
  dailyCron,
  weeklyCron,
  WEEKDAY_OPTIONS,
} from '@/lib/notifications/scheduleFormat';
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
  onDraftChange: (draft: Schedule) => void;
  onSave: (draft: Schedule) => void;
  onCancel: () => void;
}

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
  onDraftChange,
  onSave,
  onCancel,
}: ScheduleEditorProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();

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
  const [task, setTask] = useState(() => {
    const actions = parsePayload(schedule?.payload ?? '{}').actions ?? [];
    const spawn = actions.find((action) => action.kind === 'spawn-agent');
    return spawn?.kind === 'spawn-agent' ? spawn.task : '';
  });
  const [body, setBody] = useState(() => parsePayload(schedule?.payload ?? '{}').body ?? '');

  const draft = useMemo<Schedule>(() => {
    const trimmedTask = task.trim();
    const payload: SchedulePayload = {
      title: name.trim() || 'Erinnerung',
      body: body.trim() || undefined,
      severity: 'info',
      // The only action a schedule offers is the one you asked for. It is a
      // button, never an automatic launch.
      actions:
        trimmedTask === ''
          ? []
          : [
              {
                id: 'run',
                label: 'Agent starten',
                kind: 'spawn-agent',
                task: trimmedTask,
                ...(defaultProjectPath !== null ? { repoPath: defaultProjectPath } : {}),
              },
            ],
    };

    const base = {
      id: schedule?.id ?? crypto.randomUUID(),
      name: name.trim() || 'Erinnerung',
      enabled: schedule?.enabled ?? true,
      projectPath: schedule?.projectPath ?? defaultProjectPath,
      projectName: schedule?.projectName ?? defaultProjectName,
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
    body,
    catchUp,
    cronExpr,
    defaultProjectName,
    defaultProjectPath,
    everyN,
    everyUnit,
    name,
    rhythm,
    schedule,
    task,
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

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-editor-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        className="w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-panel-bg p-4 shadow-2xl"
        style={{ maxHeight: '85vh' }}
      >
        <h2
          id="schedule-editor-title"
          className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-foreground-muted"
        >
          {schedule === null ? 'Neuer Zeitplan' : 'Zeitplan bearbeiten'}
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

        <Field label="Rhythmus">
          <select
            data-testid="schedule-rhythm"
            value={rhythm}
            onChange={(event) => setRhythm(event.target.value as RhythmChoice)}
            className={INPUT}
          >
            <option value="daily">täglich</option>
            <option value="weekly">wöchentlich</option>
            <option value="interval">alle N Tage / Wochen / Stunden</option>
            <option value="cron">eigener Cron-Ausdruck</option>
          </select>
        </Field>

        {rhythm === 'weekly' && (
          <Field label="Wochentage">
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
          <Field label="Abstand">
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
                <option value="hour">Stunden</option>
                <option value="day">Tage</option>
                <option value="week">Wochen</option>
              </select>
            </div>
          </Field>
        )}

        {rhythm === 'cron' && (
          <Field label="Cron-Ausdruck">
            <input
              data-testid="schedule-cron"
              value={cronExpr}
              onChange={(event) => setCronExpr(event.target.value)}
              placeholder="0 0 17 * * WED"
              className={`${INPUT} font-mono`}
            />
            <p className="mt-1 text-[9px] text-foreground-muted/60">
              Sekunden zuerst. Wochentage als Namen (MON, WED) — Zahlen zählen hier anders als im
              üblichen Cron.
            </p>
          </Field>
        )}

        {(rhythm !== 'interval' || everyUnit !== 'hour') && (
          <Field label="Uhrzeit">
            <input
              data-testid="schedule-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className={`${INPUT} w-32`}
            />
          </Field>
        )}

        <Field label="Aktion">
          <input
            data-testid="schedule-task"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="Serverscan durchführen"
            className={INPUT}
          />
          <p className="mt-1 text-[9px] text-foreground-muted/60">
            Wird als Button {'"Agent starten"'} angeboten. Nichts läuft ohne deinen Klick.
          </p>
        </Field>

        <Field label="Notiz">
          <input
            data-testid="schedule-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Optionaler Zusatztext"
            className={INPUT}
          />
        </Field>

        <Field label="Wenn AuricIDE zu war">
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
            Nächste Termine
          </p>
          {preview.length === 0 ? (
            <p data-testid="schedule-preview-empty" className="text-[10px] text-[#ffce2e]">
              Kein Termin berechenbar — Rhythmus prüfen.
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
            Abbrechen
          </button>
          <button
            data-testid="schedule-save"
            onClick={() => onSave(draft)}
            disabled={name.trim() === ''}
            className="rounded-lg bg-primary/20 px-3 py-1.5 text-[11px] font-bold text-primary-light transition-colors hover:bg-primary/30 disabled:opacity-40"
          >
            Speichern
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
