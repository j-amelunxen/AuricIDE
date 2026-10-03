import type { GoalTableData } from './goalTable';

/**
 * The goal table as an .xlsx workbook, base64-encoded for `write_file_base64`.
 * exceljs is loaded on demand: it is large and only an export needs it.
 */
export async function toXlsxBase64(table: GoalTableData, sheetName: string): Promise<string> {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.addRow(table.columns.map((c) => c.label)).font = { bold: true };
  for (const row of table.rows) sheet.addRow(row.cells);
  sheet.addRow(table.totals).font = { bold: true };
  if (table.notes.length > 0) {
    sheet.addRow([]);
    for (const note of table.notes) sheet.addRow([note]).font = { italic: true };
  }

  table.columns.forEach((column, index) => {
    const col = sheet.getColumn(index + 1);
    if (column.id === 'cost') col.numFmt = '#,##0.00';
    else if (column.numeric) col.numFmt = '#,##0';
    const longest = Math.max(
      column.label.length,
      ...table.rows.map((r) => String(r.cells[index] ?? '').length),
      String(table.totals[index] ?? '').length
    );
    col.width = Math.min(60, Math.max(10, longest + 2));
    col.alignment = { horizontal: column.numeric ? 'right' : 'left' };
  });

  return bytesToBase64(new Uint8Array(await book.xlsx.writeBuffer()));
}

/** The webview has no `Buffer`; `btoa` takes a binary string, built in slices to spare the stack. */
function bytesToBase64(bytes: Uint8Array): string {
  const SLICE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(binary);
}
