import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionCreateDialog } from './MissionCreateDialog';

const createMock = vi.fn(async (_input: unknown) => ({ mission: {}, schedule: {} }));
vi.mock('@/lib/missions/create', () => ({
  createMissionWithSchedule: (input: unknown) => createMock(input),
}));

describe('MissionCreateDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a name and objective', () => {
    render(
      <MissionCreateDialog
        projectPath="/repo/acme"
        projectName="acme"
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByTestId('mission-create-submit')).toBeDisabled();
  });

  it('creates a project-bound recurring mission', async () => {
    const onCreated = vi.fn();
    render(
      <MissionCreateDialog
        projectPath="/repo/acme"
        projectName="acme"
        onCreated={onCreated}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByTestId('mission-name'), { target: { value: 'Weekly review' } });
    fireEvent.change(screen.getByTestId('mission-objective'), {
      target: { value: 'Turn customer signals into one shipped improvement.' },
    });
    fireEvent.change(screen.getByTestId('mission-rhythm'), { target: { value: 'weekly' } });
    fireEvent.change(screen.getByTestId('mission-weekday'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('mission-create-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/repo/acme',
        name: 'Weekly review',
        recurrence: expect.objectContaining({ kind: 'weekly', weekday: 3 }),
      })
    );
  });

  it('keeps the form open and explains a create-only collision', async () => {
    createMock.mockRejectedValueOnce(new Error('Mission `weekly-review` already exists'));
    render(
      <MissionCreateDialog
        projectPath="/repo/acme"
        projectName="acme"
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByTestId('mission-name'), { target: { value: 'Weekly review' } });
    fireEvent.change(screen.getByTestId('mission-objective'), { target: { value: 'Review' } });
    fireEvent.click(screen.getByTestId('mission-create-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });
});
