import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NotificationAction } from '@/lib/notifications/types';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import type { Schedule, SchedulePayload } from '@/lib/tauri/schedules';
import { ScheduleEditor, type ScheduleEditorProps } from './ScheduleEditor';

const { managerRegistry } = vi.hoisted(() => ({ managerRegistry: vi.fn() }));
vi.mock('@/lib/tauri/supervisorManagers', () => ({
  managerRegistry,
  MANAGERS_CHANGED_EVENT: 'auric:managers-changed',
}));

const manager = (key: string, name: string, over: Partial<SupervisorManager> = {}) => ({
  key,
  name,
  runDir: `2026-10-21_${key}`,
  promotedAt: '2026-10-21T09:00:00Z',
  archivedAt: null,
  lastLaunch: null,
  ...over,
});

const REGISTRY = [
  manager('release-desk', 'Release Desk'),
  manager('inbox-triage', 'Inbox Triage'),
  manager('old-desk', 'Old Desk', { archivedAt: '2026-10-10T00:00:00Z' }),
  manager('gone-desk', 'Gone Desk', { runMissing: true }),
];

function scheduleWith(action: NotificationAction): Schedule {
  return {
    id: 's-manager',
    name: 'Monday triage',
    enabled: true,
    projectPath: null,
    projectName: null,
    specKind: 'cron',
    cronExpr: '0 0 9 * * MON',
    everyN: null,
    everyUnit: null,
    anchorAt: null,
    timeOfDay: '09:00',
    timezone: 'Europe/Berlin',
    catchUp: 'coalesce',
    payload: JSON.stringify({ title: 'Monday triage', actions: [action] }),
    lastFiredAt: null,
    lastCheckedAt: null,
    nextDueAt: null,
    createdAt: '2026-08-12 07:00:00',
    updatedAt: '2026-08-12 07:00:00',
  };
}

function renderEditor(over: Partial<ScheduleEditorProps> = {}) {
  const props: ScheduleEditorProps = {
    schedule: null,
    defaultProjectPath: null,
    defaultProjectName: null,
    preview: [],
    starredProjects: [],
    projectOptions: [],
    discoveredSkills: [],
    providers: [],
    onDraftChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  render(<ScheduleEditor {...props} />);
  return props;
}

const lastDraft = (props: ScheduleEditorProps) =>
  (props.onDraftChange as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Schedule;
const actionsOf = (schedule: Schedule) =>
  (JSON.parse(schedule.payload) as SchedulePayload).actions ?? [];

describe('ScheduleEditor: open a Project Manager', () => {
  beforeEach(() => {
    managerRegistry.mockReset().mockResolvedValue({ managers: REGISTRY, error: null });
  });

  async function chooseManager(key: string) {
    fireEvent.click(screen.getByTestId('schedule-action-manager'));
    const picker = screen.getByTestId('schedule-manager');
    await waitFor(() => expect(picker.querySelector(`option[value="${key}"]`)).not.toBeNull());
    fireEvent.change(picker, { target: { value: key } });
  }

  it('is a choice that needs no project', () => {
    renderEditor();
    expect(screen.getByTestId('schedule-action-manager')).toBeEnabled();
  });

  it('offers only managers that can be opened', async () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('schedule-action-manager'));
    const picker = screen.getByTestId('schedule-manager');
    await waitFor(() => expect(picker.querySelectorAll('option')).toHaveLength(3));
    expect([...picker.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Choose a Project Manager…',
      'Inbox Triage',
      'Release Desk',
    ]);
  });

  it('writes nothing until a manager is picked, and holds the save', () => {
    const props = renderEditor();
    fireEvent.change(screen.getByTestId('schedule-name'), { target: { value: 'Triage' } });
    fireEvent.click(screen.getByTestId('schedule-action-manager'));
    expect(actionsOf(lastDraft(props))).toEqual([]);
    expect(screen.getByTestId('schedule-save')).toBeDisabled();
  });

  it('turns the pick into an open-manager button that waits for the click', async () => {
    const props = renderEditor();
    await chooseManager('release-desk');
    expect(actionsOf(lastDraft(props))).toEqual([
      {
        id: 'open',
        label: 'Open Release Desk',
        kind: 'open-manager',
        managerKey: 'release-desk',
        managerName: 'Release Desk',
        launch: 'direct',
      },
    ]);
    expect(screen.getByText('Offered as a button. Nothing runs without your click.')).toBeVisible();
  });

  it('carries a trimmed task, and leaves a blank one out', async () => {
    const props = renderEditor();
    await chooseManager('release-desk');
    fireEvent.change(screen.getByTestId('schedule-manager-task'), {
      target: { value: '  Summarise the week.  ' },
    });
    expect(actionsOf(lastDraft(props))[0]).toMatchObject({ task: 'Summarise the week.' });
    fireEvent.change(screen.getByTestId('schedule-manager-task'), { target: { value: '   ' } });
    expect(actionsOf(lastDraft(props))[0]).not.toHaveProperty('task');
  });

  it('says what Auto does, and writes launch auto', async () => {
    const props = renderEditor();
    await chooseManager('release-desk');
    expect(screen.queryByTestId('schedule-manager-auto-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('schedule-manager-launch-auto'));
    expect(screen.getByTestId('schedule-manager-auto-hint')).toHaveTextContent(
      'without switching your project'
    );
    expect(actionsOf(lastDraft(props))[0]).toMatchObject({ launch: 'auto' });
  });

  it('keeps the name in step with the manager picked', async () => {
    const props = renderEditor();
    await chooseManager('release-desk');
    await chooseManager('inbox-triage');
    expect(actionsOf(lastDraft(props))[0]).toMatchObject({
      managerKey: 'inbox-triage',
      managerName: 'Inbox Triage',
      label: 'Open Inbox Triage',
    });
  });

  it('opens a saved action back into the same fields and writes the same action out', async () => {
    const saved: NotificationAction = {
      id: 'open',
      label: 'Open Release Desk',
      kind: 'open-manager',
      managerKey: 'release-desk',
      managerName: 'Release Desk',
      task: 'Summarise the week.',
      launch: 'auto',
    };
    const props = renderEditor({ schedule: scheduleWith(saved) });
    expect((screen.getByTestId('schedule-action-manager') as HTMLInputElement).checked).toBe(true);
    await waitFor(() =>
      expect((screen.getByTestId('schedule-manager') as HTMLSelectElement).value).toBe(
        'release-desk'
      )
    );
    expect(screen.getByTestId('schedule-manager-task')).toHaveValue('Summarise the week.');
    expect((screen.getByTestId('schedule-manager-launch-auto') as HTMLInputElement).checked).toBe(
      true
    );
    expect(actionsOf(lastDraft(props))).toEqual([saved]);
  });

  it('reads a saved action without a launch as on click', () => {
    const saved: NotificationAction = {
      id: 'open',
      label: 'Open Release Desk',
      kind: 'open-manager',
      managerKey: 'release-desk',
      managerName: 'Release Desk',
    };
    renderEditor({ schedule: scheduleWith(saved) });
    expect((screen.getByTestId('schedule-manager-launch-direct') as HTMLInputElement).checked).toBe(
      true
    );
  });

  it('keeps a saved manager that is no longer available visible instead of swapping it', async () => {
    const saved: NotificationAction = {
      id: 'open',
      label: 'Open Old Desk',
      kind: 'open-manager',
      managerKey: 'old-desk',
      managerName: 'Old Desk',
    };
    const props = renderEditor({ schedule: scheduleWith(saved) });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Old Desk (not available)' })).toBeInTheDocument()
    );
    expect((screen.getByTestId('schedule-manager') as HTMLSelectElement).value).toBe('old-desk');
    expect(actionsOf(lastDraft(props))[0]).toMatchObject({ managerKey: 'old-desk' });
  });

  it('saves the draft it shows', async () => {
    const props = renderEditor();
    fireEvent.change(screen.getByTestId('schedule-name'), { target: { value: 'Triage' } });
    await chooseManager('inbox-triage');
    fireEvent.click(screen.getByTestId('schedule-save'));
    const saved = (props.onSave as ReturnType<typeof vi.fn>).mock.calls[0][0] as Schedule;
    expect(actionsOf(saved)[0]).toMatchObject({ kind: 'open-manager', managerKey: 'inbox-triage' });
  });
});
