import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { NotificationAction } from '@/lib/notifications/types';
import { comboPreview } from '@/lib/quickAccess/combo';
import { useStore } from '@/lib/store';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import type { Schedule, SchedulePayload } from '@/lib/tauri/schedules';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { ScheduleEditor, type ScheduleEditorProps } from './ScheduleEditor';

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'claude',
    name: 'Claude',
    models: [
      { value: 'opus', label: 'Opus' },
      { value: 'sonnet', label: 'Sonnet' },
    ],
    permissionModes: [
      { value: 'default', label: 'Interactive', description: 'Ask for permissions' },
      { value: 'acceptEdits', label: 'Accept edits', description: 'Edit without asking' },
    ],
    defaultModel: 'sonnet',
    defaultPermissionMode: 'default',
  },
  {
    id: 'codex',
    name: 'Codex',
    models: [{ value: 'gpt', label: 'GPT' }],
    permissionModes: [{ value: 'auto', label: 'Auto', description: 'Run on its own' }],
    defaultModel: 'gpt',
    defaultPermissionMode: 'auto',
  },
];

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
    projectOptions: [{ path: '/repo/sample', name: 'sample-project', starred: true }],
    discoveredSkills: [],
    providers: PROVIDERS,
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

    it('writes the agent, model and permission the custom launch was given', () => {
      const props = renderEditor();
      fireEvent.click(screen.getByTestId('schedule-action-task'));
      fireEvent.change(screen.getByTestId('schedule-task'), { target: { value: 'Scan' } });
      fireEvent.change(screen.getByTestId('schedule-task-provider'), {
        target: { value: 'claude' },
      });
      fireEvent.change(screen.getByTestId('schedule-task-model'), { target: { value: 'opus' } });
      fireEvent.change(screen.getByTestId('schedule-task-permission'), {
        target: { value: 'acceptEdits' },
      });

      expect(
        payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions?.[0]
      ).toEqual({
        id: 'run',
        label: 'Start agent',
        kind: 'spawn-agent',
        task: 'Scan',
        repoPath: '/repo/sample',
        provider: 'claude',
        model: 'opus',
        permissionMode: 'acceptEdits',
      });
    });

    // A model and a permission mode name something inside one harness. Left
    // standing across a change of agent they would be replaced at launch
    // anyway — so the form does not keep claiming them.
    it('drops the model and permission when the agent is changed', () => {
      const props = renderEditor();
      fireEvent.click(screen.getByTestId('schedule-action-task'));
      fireEvent.change(screen.getByTestId('schedule-task'), { target: { value: 'Scan' } });
      fireEvent.change(screen.getByTestId('schedule-task-provider'), {
        target: { value: 'claude' },
      });
      fireEvent.change(screen.getByTestId('schedule-task-model'), { target: { value: 'opus' } });
      fireEvent.change(screen.getByTestId('schedule-task-provider'), {
        target: { value: 'codex' },
      });

      expect(
        payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions?.[0]
      ).toEqual({
        id: 'run',
        label: 'Start agent',
        kind: 'spawn-agent',
        task: 'Scan',
        repoPath: '/repo/sample',
        provider: 'codex',
      });
    });

    it('offers only the chosen agent’s models and permission modes', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('schedule-action-task'));
      fireEvent.change(screen.getByTestId('schedule-task-provider'), {
        target: { value: 'codex' },
      });

      const models = screen.getByTestId('schedule-task-model') as HTMLSelectElement;
      expect([...models.options].map((option) => option.value)).toEqual(['', 'gpt']);

      const modes = screen.getByTestId('schedule-task-permission') as HTMLSelectElement;
      expect([...modes.options].map((option) => option.value)).toEqual(['', 'auto']);
    });

    // Configuring nothing has to keep meaning what it always meant.
    it('names no agent when the launch was left as it was', () => {
      const props = renderEditor();
      fireEvent.click(screen.getByTestId('schedule-action-task'));
      fireEvent.change(screen.getByTestId('schedule-task'), { target: { value: 'Scan' } });

      const action = payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>))
        .actions?.[0];
      expect(action).not.toHaveProperty('provider');
      expect(action).not.toHaveProperty('permissionMode');
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
        // Refreshing the prompt must not quietly change how the button behaves:
        // this schedule was saved before direct start existed.
        launch: 'dialog',
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
            launch: 'direct',
          },
        ]
      );
    });

    // The point of configuring the launch in advance: the notification arrives,
    // one click, the agent works. A second dialog to confirm what was already
    // decided is the friction this removes.
    it('starts a newly picked skill on the click', () => {
      const props = renderEditor({ starredProjects: [matchingStarred] });
      fireEvent.click(screen.getByTestId('schedule-action-skill'));
      fireEvent.change(screen.getByTestId('schedule-skill-select'), {
        target: { value: 'skill-1' },
      });

      expect(
        payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions?.[0]
      ).toMatchObject({ launch: 'direct' });
      expect((screen.getByTestId('schedule-skill-direct') as HTMLInputElement).checked).toBe(true);
    });

    it('puts the spawn dialog back when the direct start is switched off', () => {
      const props = renderEditor({ starredProjects: [matchingStarred] });
      fireEvent.click(screen.getByTestId('schedule-action-skill'));
      fireEvent.change(screen.getByTestId('schedule-skill-select'), {
        target: { value: 'skill-1' },
      });
      fireEvent.click(screen.getByTestId('schedule-skill-direct'));

      expect(
        payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions?.[0]
      ).toMatchObject({ launch: 'dialog' });
    });

    // Opening an old schedule must not silently arm it.
    it('leaves a schedule saved before direct start on the dialog', () => {
      renderEditor({
        schedule: scheduleWith(runSkillAction),
        starredProjects: [matchingStarred],
      });

      expect((screen.getByTestId('schedule-skill-direct') as HTMLInputElement).checked).toBe(false);
    });

    it('keeps the direct start when a different skill is picked', () => {
      const props = renderEditor({
        schedule: scheduleWith({ ...runSkillAction, launch: 'direct' }),
        starredProjects: [matchingStarred],
        discoveredSkills: [reviewSkill],
      });
      fireEvent.change(screen.getByTestId('schedule-skill-select'), {
        target: { value: 'discovered:/review' },
      });

      expect(
        payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions?.[0]
      ).toMatchObject({ skillLabel: 'Review', launch: 'direct' });
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

    it('explains how to add a skill when the project has no Quick Access', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('schedule-action-skill'));
      expect(
        screen.getByText('No Quick Access is set up for this project. Add a skill there first.')
      ).toBeTruthy();
    });
  });

  describe('choosing the project a reminder belongs to', () => {
    const twoProjects = [
      { path: '/repo/sample', name: 'sample-project', starred: true },
      { path: '/repo/other', name: 'other-project', starred: false },
    ];

    it('starts on the open project for a new schedule', () => {
      renderEditor({ projectOptions: twoProjects });
      expect(screen.getByTestId<HTMLSelectElement>('schedule-project').value).toBe('/repo/sample');
    });

    it('starts on the stored project when editing, not on the open one', () => {
      renderEditor({
        schedule: existing,
        defaultProjectPath: '/repo/other',
        defaultProjectName: 'other-project',
        projectOptions: twoProjects,
      });

      expect(screen.getByTestId<HTMLSelectElement>('schedule-project').value).toBe('/repo/sample');
    });

    it('retargets the schedule and its action at the project that was picked', () => {
      const props = renderEditor({ schedule: existing, projectOptions: twoProjects });
      fireEvent.change(screen.getByTestId('schedule-project'), {
        target: { value: '/repo/other' },
      });

      const draft = lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>);
      expect(draft.projectPath).toBe('/repo/other');
      expect(draft.projectName).toBe('other-project');
      expect(payloadOf(draft).actions?.[0]).toMatchObject({ repoPath: '/repo/other' });
    });

    it('can aim a reminder at no project at all', () => {
      const props = renderEditor({ schedule: existing, projectOptions: twoProjects });
      fireEvent.change(screen.getByTestId('schedule-project'), { target: { value: '' } });

      const draft = lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>);
      expect(draft.projectPath).toBeNull();
      expect(draft.projectName).toBeNull();
      expect(screen.getByTestId<HTMLInputElement>('schedule-action-skill').disabled).toBe(true);
    });

    // The whole point: an app-wide reminder can be given a project, and only
    // then does it get a skill catalogue to choose from.
    it('unlocks Skill and Combo once an app-wide schedule is given a project', () => {
      renderEditor({
        schedule: { ...existing, projectPath: null, projectName: null },
        projectOptions: twoProjects,
      });
      expect(screen.getByTestId<HTMLInputElement>('schedule-action-skill').disabled).toBe(true);

      fireEvent.change(screen.getByTestId('schedule-project'), {
        target: { value: '/repo/other' },
      });
      expect(screen.getByTestId<HTMLInputElement>('schedule-action-skill').disabled).toBe(false);
    });

    // A snapshot names a skill in project A. Carrying it over to B would keep
    // the old prompt and label while pointing the run at the wrong repository.
    it('drops the chosen skill when the project changes, and blocks saving until one is re-picked', () => {
      const props = renderEditor({
        schedule: scheduleWith(runSkillAction),
        starredProjects: [matchingStarred],
        projectOptions: twoProjects,
      });
      expect(screen.getByTestId<HTMLSelectElement>('schedule-skill-select').value).toBe('skill-1');

      fireEvent.change(screen.getByTestId('schedule-project'), {
        target: { value: '/repo/other' },
      });

      expect(screen.getByTestId<HTMLSelectElement>('schedule-skill-select').value).toBe('');
      expect(screen.getByTestId<HTMLButtonElement>('schedule-save').disabled).toBe(true);
      expect(payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions).toEqual(
        []
      );
      expect(props.onSave).not.toHaveBeenCalled();
    });

    it('drops the chosen combo when the project changes', () => {
      renderEditor({
        schedule: scheduleWith(runComboAction, { name: 'Blog-Write' }),
        starredProjects: [matchingStarred],
        projectOptions: twoProjects,
      });

      fireEvent.change(screen.getByTestId('schedule-project'), {
        target: { value: '/repo/other' },
      });

      expect(screen.getByTestId<HTMLSelectElement>('schedule-combo-select').value).toBe('');
      expect(screen.getByTestId<HTMLButtonElement>('schedule-save').disabled).toBe(true);
    });

    // A typed task is not project-specific — only its repoPath is, and that
    // follows the picker on its own.
    it('keeps a typed custom-agent task across a project change', () => {
      const props = renderEditor({ schedule: existing, projectOptions: twoProjects });
      fireEvent.change(screen.getByTestId('schedule-project'), {
        target: { value: '/repo/other' },
      });

      expect(screen.getByTestId<HTMLInputElement>('schedule-task').value).toBe('scan');
      expect(payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions).toEqual(
        [
          {
            id: 'run',
            label: 'Start agent',
            kind: 'spawn-agent',
            task: 'scan',
            repoPath: '/repo/other',
          },
        ]
      );
    });

    it('draws the project tile next to the picker', () => {
      renderEditor({ projectOptions: twoProjects });
      expect(screen.getByTestId('tile-face-/repo/sample')).toBeTruthy();
    });
  });
});
