import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalTableData } from './goalTable';

const save = vi.fn();
const writeFile = vi.fn();
const writeFileBase64 = vi.fn();

vi.mock('@tauri-apps/plugin-dialog', () => ({ save }));
vi.mock('@/lib/tauri/fs', () => ({ writeFile, writeFileBase64 }));

const table: GoalTableData = {
  columns: [{ id: 'name', label: 'Name', numeric: false }],
  rows: [{ goalId: 'a', cells: ['Alpha'] }],
  totals: ['Total'],
  notes: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exportGoalTable', () => {
  it('writes the CSV as text to the chosen path', async () => {
    save.mockResolvedValue('/tmp/out.csv');
    const { exportGoalTable } = await import('./exportGoalTable');
    const path = await exportGoalTable(table, 'csv', 'Mission X');
    expect(path).toBe('/tmp/out.csv');
    expect(save.mock.calls[0][0]).toMatchObject({
      defaultPath: 'mission-x-sub-goals.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    expect(writeFile).toHaveBeenCalledWith('/tmp/out.csv', expect.stringContaining('Alpha'));
    expect(writeFileBase64).not.toHaveBeenCalled();
  });

  it('writes the workbook as base64 to the chosen path', async () => {
    save.mockResolvedValue('/tmp/out.xlsx');
    const { exportGoalTable } = await import('./exportGoalTable');
    await exportGoalTable(table, 'xlsx', 'Mission X');
    expect(save.mock.calls[0][0].defaultPath).toBe('mission-x-sub-goals.xlsx');
    const [path, base64] = writeFileBase64.mock.calls[0];
    expect(path).toBe('/tmp/out.xlsx');
    // A zip starts with "PK", which is "UEs" in base64.
    expect(base64.startsWith('UEs')).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('writes nothing when the dialog is cancelled', async () => {
    save.mockResolvedValue(null);
    const { exportGoalTable } = await import('./exportGoalTable');
    expect(await exportGoalTable(table, 'csv', 'x')).toBeNull();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('falls back to a plain file name for a goal name with no usable characters', async () => {
    save.mockResolvedValue(null);
    const { exportGoalTable } = await import('./exportGoalTable');
    await exportGoalTable(table, 'csv', '///');
    expect(save.mock.calls[0][0].defaultPath).toBe('goal-sub-goals.csv');
  });
});
