import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { NotificationAction } from '@/lib/notifications/types';
import { comboPreview } from '@/lib/quickAccess/combo';
import { useStore } from '@/lib/store';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import type { Schedule, SchedulePayload } from '@/lib/tauri/schedules';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';
import { ScheduleEditor, type ScheduleEditorProps } from './ScheduleEditor';

const runSkillAction: Extract<NotificationAction, { kind: 'run-skill' }> = {
  id: 'run',
  label: 'Changelog starten',
  kind: 'run-skill',
  skillId: 'skill-1',
  skillLabel: 'Changelog',
  prompt: '/changelog',
  repoPath: '/repo/sample',
  providerId: 'claude',
  model: 'opus',
  permissionMode: 'plan',
  invocation: '/changelog',
};

const runComboAction: Extract<NotificationAction, { kind: 'run-combo' }> = {
  id: 'run',
  label: 'Blog-Write starten',
  kind: 'run-combo',
  comboId: 'c1',
  comboLabel: 'Blog-Write',
  repoPath: '/repo/sample',
  steps: [
    { id: 's1', label: 'Draft', prompt: '/draft' },
    { id: 's2', label: 'Polish', prompt: 'tighten the wording' },
  ],
};

const matchingStarred: StarredProject = {
  path: '/repo/sample',
  name: 'sample',
  starredAt: 1,
  skills: [
    {
      id: 'skill-1',
      label: 'Changelog',
      prompt: '/changelog',
      providerId: 'claude',
      model: 'opus',
      permissionMode: 'plan',
      invocation: '/changelog',
    },
  ],
  combos: [
    {
      id: 'c1',
      label: 'Blog-Write',
      steps: [
        { id: 's1', label: 'Draft', prompt: '/draft' },
        { id: 's2', label: 'Polish', prompt: 'tighten the wording' },
      ],
    },
  ],
};

const driftedStarred: StarredProject = {
  path: '/repo/sample',
  name: 'sample',
  starredAt: 1,
  skills: [
    { id: 'skill-1', label: 'Changelog', prompt: '/changelog-v2', invocation: '/changelog' },
  ],
  combos: [],
};

const reviewSkill: ProjectSkill = {
  invocation: '/review',
  name: 'Review',
  description: null,
  source: 'skill',
  scope: 'project',
  path: '/repo/sample/.claude/skills/review/SKILL.md',
  sourceId: 'claude',
};

function scheduleWith(
  action: NotificationAction | undefined,
  overrides: Partial<Schedule> = {}
): Schedule {
  return {
    id: 's-skill',
    name: 'Weekly changelog',
    enabled: true,
    projectPath: '/repo/sample',
    projectName: 'sample',
    specKind: 'cron',
    cronExpr: '0 0 9 * * WED',
    everyN: null,
    everyUnit: null,
    anchorAt: null,
    timeOfDay: '09:00',
    timezone: 'Europe/Berlin',
    catchUp: 'coalesce',
    payload: JSON.stringify({
      title: 'Weekly changelog',
      actions: action ? [action] : [],
    }),
    lastFiredAt: null,
    lastCheckedAt: null,
    nextDueAt: null,
    createdAt: '2026-08-12 07:00:00',
    updatedAt: '2026-08-12 07:00:00',
    ...overrides,
  };
}

function renderEditor(overrides: Partial<ScheduleEditorProps> = {}) {
  const props: ScheduleEditorProps = {
    schedule: null,
    defaultProjectPath: '/repo/sample',
    defaultProjectName: 'sample-project',
    preview: ['Mi 19.08.2026 09:00'],
    starredProjects: [],
    discoveredSkills: [],
    onDraftChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ScheduleEditor {...props} />);
  return props;
}

/** The draft the form last produced. */
function lastDraft(onDraftChange: ReturnType<typeof vi.fn>): Schedule {
  return onDraftChange.mock.calls.at(-1)![0] as Schedule;
}

function lastSaved(onSave: ScheduleEditorProps['onSave']): Schedule {
  return (onSave as ReturnType<typeof vi.fn>).mock.calls[0][0] as Schedule;
}

function payloadOf(schedule: Schedule): SchedulePayload {
  return JSON.parse(schedule.payload) as SchedulePayload;
}

describe('ScheduleEditor', () => {
  afterEach(() => {
    useStore.setState({ overlayStack: { layers: [] } });
  });

  it('is a labelled modal dialog', () => {
    renderEditor();
    const dialog = screen.getByRole('dialog', { name: 'New schedule' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('schedule-editor-title');
  });

  it('cannot be saved without a name', () => {
    renderEditor();
    expect(screen.getByTestId<HTMLButtonElement>('schedule-save').disabled).toBe(true);
  });

  it('cancels on Escape', () => {
    const props = renderEditor();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalled();
  });

  it('registers as a tool overlay so a confirm on top owns Escape', () => {
    renderEditor();
    expect(useStore.getState().overlayStack.layers.at(-1)).toEqual(
      expect.objectContaining({ id: 'schedule-editor', kind: 'tool' })
    );
  });

  it('sits on the tool-nested layer', () => {
    renderEditor();
    expect(screen.getByRole('dialog').parentElement?.className).toContain(
      'z-[var(--z-tool-nested)]'
    );
  });

  it('labels the form chrome in English', () => {
    renderEditor();
    expect(screen.getByText('Rhythm')).toBeTruthy();
    expect(screen.getByText('Action')).toBeTruthy();
    expect(screen.getByText('Reminder only')).toBeTruthy();
    expect(screen.getByText('Custom agent')).toBeTruthy();
    expect(screen.getByText('If AuricIDE was closed')).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  describe('the rhythm it produces', () => {
    it('defaults to a weekly cron with a named weekday', () => {
      const props = renderEditor();
      const draft = lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>);

      expect(draft.specKind).toBe('cron');
      expect(draft.cronExpr).toBe('0 0 9 * * WED');
    });

    it('builds a daily expression', () => {
      const props = renderEditor();
      fireEvent.change(screen.getByTestId('schedule-rhythm'), { target: { value: 'daily' } });

      expect(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>).cronExpr).toBe(
        '0 0 9 * * *'
      );
    });

    it('switches to an interval spec', () => {
      const props = renderEditor();
      fireEvent.change(screen.getByTestId('schedule-rhythm'), { target: { value: 'interval' } });
      fireEvent.change(screen.getByTestId('schedule-every-n'), { target: { value: '21' } });

      const draft = lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>);
      expect(draft.specKind).toBe('every');
      expect(draft.everyN).toBe(21);
      expect(draft.cronExpr).toBeNull();
    });

    // An hourly rhythm has no time of day to keep.
    it('drops the time of day for an hourly interval', () => {
      const props = renderEditor();
      fireEvent.change(screen.getByTestId('schedule-rhythm'), { target: { value: 'interval' } });
      fireEvent.change(screen.getByTestId('schedule-every-unit'), { target: { value: 'hour' } });

      expect(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>).timeOfDay).toBeNull();
      expect(screen.queryByTestId('schedule-time')).toBeNull();
    });

    it('carries the chosen weekdays into the expression', () => {
      const props = renderEditor();
      fireEvent.click(screen.getByTestId('schedule-weekday-MON'));

      expect(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>).cronExpr).toContain('MON');
    });

    it('rejects an interval below one', () => {
      const props = renderEditor();
      fireEvent.change(screen.getByTestId('schedule-rhythm'), { target: { value: 'interval' } });
      fireEvent.change(screen.getByTestId('schedule-every-n'), { target: { value: '0' } });

      expect(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>).everyN).toBe(1);
    });
  });

  describe('the notification it will raise', () => {
    // The whole point of the "remind only" decision: the reminder offers a
    // button, it never launches anything itself.
    it('turns the task into a spawn button, not an automatic launch', () => {
      const props = renderEditor();
      fireEvent.click(screen.getByTestId('schedule-action-task'));
      fireEvent.change(screen.getByTestId('schedule-task'), {
        target: { value: 'Serverscan durchführen' },
      });

      const actions = payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions;
      expect(actions).toEqual([
        {
          id: 'run',
          label: 'Start agent',
          kind: 'spawn-agent',
          task: 'Serverscan durchführen',
          repoPath: '/repo/sample',
        },
      ]);
    });

    it('offers no action at all when no task was named', () => {
      const props = renderEditor();
      expect(payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions).toEqual(
        []
      );
    });

    it('uses the name as the notification title', () => {
      const props = renderEditor();
      fireEvent.change(screen.getByTestId('schedule-name'), { target: { value: 'Weekly digest' } });

      expect(payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).title).toBe(
        'Weekly digest'
      );
    });
  });

  describe('the preview', () => {
    it('lists the dates it was handed', () => {
      renderEditor({ preview: ['Mi 19.08.2026 09:00', 'Mi 26.08.2026 09:00'] });
      expect(screen.getByText('Mi 19.08.2026 09:00')).toBeTruthy();
    });

    // A rhythm the backend cannot compute must say so here, not fail silently
    // three weeks from now.
    it('warns when no date could be computed', () => {
      renderEditor({ preview: [] });
      expect(screen.getByTestId('schedule-preview-empty')).toBeTruthy();
    });
  });

  const existing: Schedule = {
    id: 's1',
    name: 'Security-Scan',
    enabled: true,
    projectPath: '/repo/sample',
    projectName: 'sample-project',
    specKind: 'every',
    cronExpr: null,
    everyN: 21,
    everyUnit: 'day',
    anchorAt: '2026-08-12 07:00:00',
    timeOfDay: '09:00',
    timezone: 'Europe/Berlin',
    catchUp: 'all',
    payload: JSON.stringify({
      title: 'Security-Scan',
      actions: [{ id: 'run', label: 'Agent starten', kind: 'spawn-agent', task: 'scan' }],
    }),
    lastFiredAt: null,
    lastCheckedAt: null,
    nextDueAt: '2026-09-02 07:00:00',
    createdAt: '2026-08-12 07:00:00',
    updatedAt: '2026-08-12 07:00:00',
  };

  describe('editing an existing schedule', () => {
    it('fills the form from the stored schedule', () => {
      renderEditor({ schedule: existing });

      expect(screen.getByTestId<HTMLInputElement>('schedule-name').value).toBe('Security-Scan');
      expect(screen.getByTestId<HTMLSelectElement>('schedule-rhythm').value).toBe('interval');
      expect(screen.getByTestId<HTMLInputElement>('schedule-task').value).toBe('scan');
      expect(screen.getByTestId<HTMLSelectElement>('schedule-catch-up').value).toBe('all');
    });

    it('keeps the id, so saving updates rather than duplicates', () => {
      const props = renderEditor({ schedule: existing });
      expect(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>).id).toBe('s1');
    });

    // Re-anchoring on every edit would silently shift the whole series.
    it('keeps the original anchor', () => {
      const props = renderEditor({ schedule: existing });
      expect(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>).anchorAt).toBe(
        '2026-08-12 07:00:00'
      );
    });

    it('saves the current draft', () => {
      const props = renderEditor({ schedule: existing });
      fireEvent.click(screen.getByTestId('schedule-save'));

      expect(props.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: 's1', name: 'Security-Scan' })
      );
    });

    it('titles an existing schedule as edit', () => {
      renderEditor({ schedule: existing });
      expect(screen.getByRole('dialog', { name: 'Edit schedule' })).toBeTruthy();
    });

    it('selects the custom-agent choice when the stored action is spawn-agent', () => {
      renderEditor({ schedule: existing });
      expect(screen.getByTestId<HTMLInputElement>('schedule-action-task').checked).toBe(true);
    });
  });

  describe('skill, combo, and the project they belong to', () => {
    it('rewrites the stored run-skill snapshot when saved without touching the chooser', () => {
      const stored = scheduleWith(runSkillAction);
      const props = renderEditor({ schedule: stored });
      fireEvent.click(screen.getByTestId('schedule-save'));

      expect(payloadOf(lastSaved(props.onSave)).actions?.[0]).toEqual(runSkillAction);
    });

    it('rewrites the stored run-combo snapshot including its steps', () => {
      const stored = scheduleWith(runComboAction, { name: 'Blog-Write', id: 's-combo' });
      const props = renderEditor({
        schedule: stored,
        starredProjects: [matchingStarred],
      });
      fireEvent.click(screen.getByTestId('schedule-save'));

      expect(payloadOf(lastSaved(props.onSave)).actions?.[0]).toEqual(runComboAction);
    });

    it('keeps an unpinned skill selected as the stored snapshot', () => {
      const orphan = { ...runSkillAction, skillId: 'gone-skill' };
      const stored = scheduleWith(orphan);
      const props = renderEditor({ schedule: stored, starredProjects: [matchingStarred] });

      const select = screen.getByTestId<HTMLSelectElement>('schedule-skill-select');
      expect(select.value).toBe('gone-skill');
      expect(select.options[select.selectedIndex].textContent).toContain('(saved)');

      fireEvent.click(screen.getByTestId('schedule-save'));
      expect(payloadOf(lastSaved(props.onSave)).actions?.[0]).toEqual(orphan);
    });

    it('keeps a project-A schedule aimed at A when the open project is B', () => {
      const props = renderEditor({
        schedule: existing,
        defaultProjectPath: '/B',
        defaultProjectName: 'B',
      });

      const draft = lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>);
      expect(draft.projectPath).toBe('/repo/sample');
      expect(payloadOf(draft).actions).toEqual([
        {
          id: 'run',
          label: 'Start agent',
          kind: 'spawn-agent',
          task: 'scan',
          repoPath: '/repo/sample',
        },
      ]);
    });

    it('does not retarget an app-wide schedule onto the open project', () => {
      const appWide: Schedule = {
        ...existing,
        projectPath: null,
        projectName: null,
      };
      const props = renderEditor({
        schedule: appWide,
        defaultProjectPath: '/B',
        defaultProjectName: 'B',
      });

      const draft = lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>);
      expect(draft.projectPath).toBeNull();
      expect(payloadOf(draft).actions).toEqual([
        {
          id: 'run',
          label: 'Start agent',
          kind: 'spawn-agent',
          task: 'scan',
        },
      ]);
    });

    it('disables Skill and Combo on an app-wide schedule', () => {
      renderEditor({
        schedule: { ...existing, projectPath: null, projectName: null },
        defaultProjectPath: '/B',
      });

      expect(screen.getByTestId<HTMLInputElement>('schedule-action-skill').disabled).toBe(true);
      expect(screen.getByTestId<HTMLInputElement>('schedule-action-combo').disabled).toBe(true);
      expect(screen.getByTestId('schedule-skill-combo-hint').textContent).toContain(
        'Skill and Combo need a project.'
      );
      expect(screen.getByTestId<HTMLInputElement>('schedule-action-none').disabled).toBe(false);
      expect(screen.getByTestId<HTMLInputElement>('schedule-action-task').disabled).toBe(false);
    });

    it('cannot save a Skill choice with nothing selected', () => {
      renderEditor();
      fireEvent.change(screen.getByTestId('schedule-name'), { target: { value: 'Weekly' } });
      fireEvent.click(screen.getByTestId('schedule-action-skill'));

      expect(screen.getByTestId<HTMLButtonElement>('schedule-save').disabled).toBe(true);
    });

    it('cannot save a Combo choice with nothing selected', () => {
      renderEditor();
      fireEvent.change(screen.getByTestId('schedule-name'), { target: { value: 'Weekly' } });
      fireEvent.click(screen.getByTestId('schedule-action-combo'));

      expect(screen.getByTestId<HTMLButtonElement>('schedule-save').disabled).toBe(true);
    });

    it('treats a custom-agent choice with an empty task as reminder-only', () => {
      const props = renderEditor();
      fireEvent.change(screen.getByTestId('schedule-name'), { target: { value: 'Weekly' } });
      fireEvent.click(screen.getByTestId('schedule-action-task'));

      expect(screen.getByTestId<HTMLButtonElement>('schedule-save').disabled).toBe(false);
      expect(payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions).toEqual(
        []
      );
    });

    it('offers to update the snapshot when the live pin has drifted', () => {
      const stored = scheduleWith(runSkillAction);
      const props = renderEditor({
        schedule: stored,
        starredProjects: [driftedStarred],
      });

      expect(screen.getByTestId('schedule-snapshot-stale').textContent).toContain(
        'The pinned skill has changed.'
      );

      fireEvent.click(screen.getByTestId('schedule-snapshot-refresh'));
      expect(props.onSave).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('schedule-save'));
      expect(payloadOf(lastSaved(props.onSave)).actions?.[0]).toEqual({
        id: 'run',
        label: 'Start Changelog',
        kind: 'run-skill',
        skillId: 'skill-1',
        skillLabel: 'Changelog',
        prompt: '/changelog-v2',
        repoPath: '/repo/sample',
        invocation: '/changelog',
      });
    });

    it('replaces a discovered skillId with the live pin id on refresh', () => {
      const discoveredSnapshot = {
        ...runSkillAction,
        skillId: 'discovered:/changelog',
      };
      const stored = scheduleWith(discoveredSnapshot);
      const props = renderEditor({
        schedule: stored,
        starredProjects: [driftedStarred],
      });

      fireEvent.click(screen.getByTestId('schedule-snapshot-refresh'));
      fireEvent.click(screen.getByTestId('schedule-save'));

      expect(payloadOf(lastSaved(props.onSave)).actions?.[0]).toMatchObject({
        skillId: 'skill-1',
        prompt: '/changelog-v2',
      });
    });

    it('snapshots a discovered skill without pinning it', () => {
      const props = renderEditor({ discoveredSkills: [reviewSkill] });
      fireEvent.click(screen.getByTestId('schedule-action-skill'));
      fireEvent.change(screen.getByTestId('schedule-skill-select'), {
        target: { value: 'discovered:/review' },
      });

      expect(payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions).toEqual(
        [
          {
            id: 'run',
            label: 'Start Review',
            kind: 'run-skill',
            skillId: 'discovered:/review',
            skillLabel: 'Review',
            prompt: '/review',
            repoPath: '/repo/sample',
            invocation: '/review',
          },
        ]
      );
    });

    it('shows the combo step preview under the picker', () => {
      renderEditor({
        schedule: scheduleWith(runComboAction, { name: 'Blog-Write' }),
        starredProjects: [matchingStarred],
      });

      expect(screen.getByTestId('schedule-combo-preview').textContent).toBe(
        comboPreview({
          id: runComboAction.comboId,
          label: 'Blog-Write',
          steps: runComboAction.steps,
        })
      );
    });

    it('tells you when the project has no Quick Access yet', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('schedule-action-skill'));
      expect(
        screen.getByText('No Quick Access for this project — pin one there first.')
      ).toBeTruthy();
    });
  });
});
