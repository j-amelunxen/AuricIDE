import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Schedule, SchedulePayload } from '@/lib/tauri/schedules';
import { ScheduleEditor, type ScheduleEditorProps } from './ScheduleEditor';

function renderEditor(overrides: Partial<ScheduleEditorProps> = {}) {
  const props: ScheduleEditorProps = {
    schedule: null,
    defaultProjectPath: '/repo/sample',
    defaultProjectName: 'sample-project',
    preview: ['Mi 19.08.2026 09:00'],
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

function payloadOf(schedule: Schedule): SchedulePayload {
  return JSON.parse(schedule.payload) as SchedulePayload;
}

describe('ScheduleEditor', () => {
  it('is a labelled modal dialog', () => {
    renderEditor();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('schedule-editor-title');
  });

  it('cannot be saved without a name', () => {
    renderEditor();
    expect(screen.getByTestId<HTMLButtonElement>('schedule-save').disabled).toBe(true);
  });

  it('cancels on Escape', () => {
    const props = renderEditor();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalled();
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
      fireEvent.change(screen.getByTestId('schedule-task'), {
        target: { value: 'Serverscan durchführen' },
      });

      const actions = payloadOf(lastDraft(props.onDraftChange as ReturnType<typeof vi.fn>)).actions;
      expect(actions).toEqual([
        {
          id: 'run',
          label: 'Agent starten',
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

  describe('editing an existing schedule', () => {
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
  });
});
