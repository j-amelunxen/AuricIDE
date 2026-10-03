import { toCsv, type GoalTableData } from './goalTable';
import { toXlsxBase64 } from './goalTableXlsx';

export type GoalTableExportFormat = 'csv' | 'xlsx';

const FORMATS: Record<GoalTableExportFormat, { name: string; extension: string }> = {
  csv: { name: 'CSV', extension: 'csv' },
  xlsx: { name: 'Excel workbook', extension: 'xlsx' },
};

function fileStem(goalName: string): string {
  const slug = goalName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'goal'}-sub-goals`;
}

/**
 * Asks where to save, then writes the table. Returns the path, or null when the
 * dialog was cancelled. Errors from the dialog or the write reach the caller.
 */
export async function exportGoalTable(
  table: GoalTableData,
  format: GoalTableExportFormat,
  goalName: string
): Promise<string | null> {
  const { name, extension } = FORMATS[format];
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    filters: [{ name, extensions: [extension] }],
    defaultPath: `${fileStem(goalName)}.${extension}`,
    title: `Export sub-goals as ${name}`,
  });
  if (!path) return null;

  const fs = await import('@/lib/tauri/fs');
  if (format === 'csv') await fs.writeFile(path, toCsv(table));
  else await fs.writeFileBase64(path, await toXlsxBase64(table, 'Sub-goals'));
  return path;
}
