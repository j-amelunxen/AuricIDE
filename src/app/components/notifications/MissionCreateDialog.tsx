'use client';

import { FormEvent, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { createMissionWithSchedule } from '@/lib/missions/create';
import type { MissionRecurrence } from '@/lib/missions/schedule';

export interface MissionCreateDialogProps {
  projectPath: string;
  projectName: string | null;
  onCreated: () => void | Promise<void>;
  onCancel: () => void;
}

const INPUT =
  'w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-xs text-foreground outline-none focus:border-primary/60';

export function MissionCreateDialog({
  projectPath,
  projectName,
  onCreated,
  onCancel,
}: MissionCreateDialogProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [rhythm, setRhythm] = useState<'daily' | 'weekly' | 'interval'>('daily');
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [weekday, setWeekday] = useState(1);
  const [everyN, setEveryN] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useOverlayLayer({
    id: 'mission-create',
    kind: 'tool',
    active: true,
    onEscape: saving ? undefined : onCancel,
  });

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const recurrence: MissionRecurrence =
    rhythm === 'daily'
      ? { kind: 'daily', timeOfDay }
      : rhythm === 'weekly'
        ? { kind: 'weekly', weekday, timeOfDay }
        : { kind: 'interval', everyN, everyUnit: 'day', timeOfDay };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || name.trim() === '' || objective.trim() === '') return;
    setSaving(true);
    setError(null);
    try {
      await createMissionWithSchedule({
        projectPath,
        projectName,
        name,
        objective,
        recurrence,
        timezone,
      });
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-tool-nested)] flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mission-create-title"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-panel-bg p-4 shadow-2xl"
      >
        <h2
          id="mission-create-title"
          className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-foreground-muted"
        >
          New mission
        </h2>
        <p className="mb-4 text-[10px] text-foreground-muted">
          Creates a durable Markdown brief in{' '}
          <span className="font-mono text-foreground">{projectPath}/.auric/missions/</span> and
          enables an agent to run it automatically on this schedule ({timezone}).
        </p>
        <p className="mb-4 text-[10px] text-foreground-muted">
          Project:{' '}
          <span className="font-semibold text-foreground">{projectName ?? projectPath}</span>
        </p>

        <form onSubmit={(event) => void submit(event)}>
          <label className="mb-3 block text-[10px] text-foreground-muted">
            Name
            <input
              autoFocus
              data-testid="mission-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Weekly product review"
              required
              aria-describedby="mission-required-hint"
              className={`${INPUT} mt-1`}
            />
          </label>
          <label className="mb-3 block text-[10px] text-foreground-muted">
            Objective
            <textarea
              data-testid="mission-objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="What should each run move forward?"
              required
              aria-describedby="mission-required-hint"
              rows={4}
              className={`${INPUT} mt-1 resize-y`}
            />
          </label>
          <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
            <label className="text-[10px] text-foreground-muted">
              Recurrence
              <select
                data-testid="mission-rhythm"
                value={rhythm}
                onChange={(event) => setRhythm(event.target.value as typeof rhythm)}
                className={`${INPUT} mt-1`}
              >
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="interval">Every N days</option>
              </select>
            </label>
            <label className="text-[10px] text-foreground-muted">
              Time
              <input
                data-testid="mission-time"
                type="time"
                value={timeOfDay}
                onChange={(event) => setTimeOfDay(event.target.value)}
                className={`${INPUT} mt-1`}
              />
            </label>
          </div>
          {rhythm === 'weekly' && (
            <label className="mb-3 block text-[10px] text-foreground-muted">
              Weekday
              <select
                data-testid="mission-weekday"
                value={weekday}
                onChange={(event) => setWeekday(Number(event.target.value))}
                className={`${INPUT} mt-1`}
              >
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                  (label, index) => (
                    <option key={label} value={index}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </label>
          )}
          {rhythm === 'interval' && (
            <label className="mb-3 block text-[10px] text-foreground-muted">
              Number of days
              <input
                data-testid="mission-every-n"
                type="number"
                min={1}
                value={everyN}
                onChange={(event) => setEveryN(Math.max(1, Number(event.target.value)))}
                className={`${INPUT} mt-1`}
              />
            </label>
          )}
          {error !== null && (
            <p role="alert" className="mb-3 text-[10px] text-red-400">
              {error}
            </p>
          )}
          <p id="mission-required-hint" className="mb-3 text-[9px] text-foreground-muted">
            Name and objective are required.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-lg px-3 py-2 text-xs disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="mission-create-submit"
              disabled={saving || name.trim() === '' || objective.trim() === ''}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-black disabled:opacity-40"
            >
              {saving ? 'Creating…' : 'Create mission'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
