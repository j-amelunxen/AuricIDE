'use client';

import { createPortal } from 'react-dom';
import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { CATCH_UP_HINTS, CATCH_UP_LABELS } from '@/lib/notifications/scheduleFormat';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import type { ScheduleCatchUp } from '@/lib/tauri/schedules';
import { ComboActionSection } from './scheduleEditor/ComboActionSection';
import { ConductorActionSection } from './scheduleEditor/ConductorActionSection';
import { PROJECT_GROUPS, saveBlocked } from './scheduleEditor/helpers';
import { RhythmSection } from './scheduleEditor/RhythmSection';
import { SkillActionSection } from './scheduleEditor/SkillActionSection';
import { TaskActionSection } from './scheduleEditor/TaskActionSection';
import type { RhythmChoice, ScheduleEditorProps } from './scheduleEditor/types';
import { Choice, Field, INPUT } from './scheduleEditor/ui';
import { useScheduleEditorDraft } from './scheduleEditor/useScheduleEditorDraft';

export type { RhythmChoice, ScheduleEditorProps };

/**
 * The form for one reminder.
 *
 * It shows the next three occurrences as you type. That preview is not a nicety:
 * a rhythm that is subtly wrong — the wrong weekday, an interval anchored a day
 * off — is otherwise only discovered three weeks later, when the reminder you
 * were relying on does not arrive.
 */
export function ScheduleEditor(props: ScheduleEditorProps) {
  const { schedule, projectOptions, providers, preview, onSave, onCancel } = props;
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({ id: 'schedule-editor', kind: 'tool', active: true, onEscape: onCancel });

  const {
    projectPath,
    selectedProject,
    name,
    setName,
    rhythm,
    setRhythm,
    time,
    setTime,
    weekdays,
    toggleWeekday,
    everyN,
    setEveryN,
    everyUnit,
    setEveryUnit,
    cronExpr,
    setCronExpr,
    catchUp,
    setCatchUp,
    actionDraft,
    body,
    setBody,
    draft,
    conductorGoals,
    conductorGoalsLoading,
    noQuickAccess,
    pins,
    combos,
    unpinnedDiscovered,
    skillLaunch,
    skillStale,
    comboStale,
    orphanSkill,
    orphanCombo,
    chooseProject,
    chooseAction,
    setConductorDraft,
    selectConductorGoal,
    selectSkill,
    setSkillLaunch,
    setSkillHeadless,
    chooseTaskProvider,
    setTaskLaunch,
    setTaskContent,
    setSkillPins,
    chooseSkillProvider,
    selectCombo,
    refreshSkillSnapshot,
    refreshComboSnapshot,
  } = useScheduleEditorDraft(props);

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
              {PROJECT_GROUPS.map(({ starred: isStarred, title }) => {
                const entries = projectOptions.filter((option) => option.starred === isStarred);
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

        <RhythmSection
          rhythm={rhythm}
          setRhythm={setRhythm}
          weekdays={weekdays}
          toggleWeekday={toggleWeekday}
          everyN={everyN}
          setEveryN={setEveryN}
          everyUnit={everyUnit}
          setEveryUnit={setEveryUnit}
          cronExpr={cronExpr}
          setCronExpr={setCronExpr}
          time={time}
          setTime={setTime}
        />

        <fieldset className="mb-2.5">
          <legend className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-foreground-muted/70">
            Action
          </legend>
          <div className="flex flex-col gap-1">
            <Choice
              testId="schedule-action-none"
              label="Reminder only"
              checked={actionDraft.choice === 'none'}
              onSelect={() => chooseAction('none')}
            />
            <Choice
              testId="schedule-action-skill"
              label="Skill"
              checked={actionDraft.choice === 'skill'}
              disabled={projectPath === null}
              onSelect={() => chooseAction('skill')}
            />
            <Choice
              testId="schedule-action-combo"
              label="Combo"
              checked={actionDraft.choice === 'combo'}
              disabled={projectPath === null}
              onSelect={() => chooseAction('combo')}
            />
            <Choice
              testId="schedule-action-conductor"
              label="Conductor"
              checked={actionDraft.choice === 'conductor'}
              disabled={projectPath === null}
              onSelect={() => chooseAction('conductor')}
            />
            <Choice
              testId="schedule-action-task"
              label="Custom agent"
              checked={actionDraft.choice === 'task'}
              onSelect={() => chooseAction('task')}
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
              : (actionDraft.choice === 'task' && actionDraft.launch === 'auto') ||
                  (actionDraft.choice === 'skill' && actionDraft.snapshot?.launch === 'auto')
                ? 'Starts on its own in the background — no click, no project switch.'
                : 'Offered as a button. Nothing runs without your click.'}
          </p>

          {actionDraft.choice === 'task' && (
            <TaskActionSection
              task={actionDraft.task}
              onTaskChange={setTaskContent}
              providerId={actionDraft.providerId}
              model={actionDraft.model}
              permissionMode={actionDraft.permissionMode}
              launch={actionDraft.launch}
              headless={actionDraft.headless}
              providers={providers}
              onChooseProvider={chooseTaskProvider}
              onSetTaskLaunch={setTaskLaunch}
            />
          )}

          {actionDraft.choice === 'skill' && projectPath !== null && (
            <SkillActionSection
              snapshot={actionDraft.snapshot}
              skillLaunch={skillLaunch}
              noQuickAccess={noQuickAccess}
              orphanSkill={orphanSkill}
              pins={pins}
              unpinnedDiscovered={unpinnedDiscovered}
              providers={providers}
              skillStale={skillStale}
              onSelectSkill={selectSkill}
              onChooseSkillProvider={chooseSkillProvider}
              onSetSkillPins={setSkillPins}
              onSetSkillLaunch={setSkillLaunch}
              onSetSkillHeadless={setSkillHeadless}
              onRefreshSkillSnapshot={refreshSkillSnapshot}
            />
          )}

          {actionDraft.choice === 'combo' && projectPath !== null && (
            <ComboActionSection
              snapshot={actionDraft.snapshot}
              noQuickAccess={noQuickAccess}
              orphanCombo={orphanCombo}
              combos={combos}
              comboStale={comboStale}
              onSelectCombo={selectCombo}
              onRefreshComboSnapshot={refreshComboSnapshot}
            />
          )}

          {actionDraft.choice === 'conductor' && projectPath !== null && (
            <ConductorActionSection
              draft={actionDraft}
              providers={providers}
              conductorGoals={conductorGoals}
              conductorGoalsLoading={conductorGoalsLoading}
              onSetConductorDraft={setConductorDraft}
              onSelectConductorGoal={selectConductorGoal}
            />
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
