import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { GoalTableData } from './goalTable';
import { toXlsxBase64 } from './goalTableXlsx';

const table: GoalTableData = {
  columns: [
    { id: 'name', label: 'Name', numeric: false },
    { id: 'cost', label: 'Cost (USD)', numeric: true },
  ],
  rows: [
    { goalId: 'a', cells: ['Alpha', 2.5] },
    { goalId: 'b', cells: ['Beta', null] },
  ],
  totals: ['Total', 2.5],
  notes: ['Cost excludes 1 run without a known price.'],
};

async function read(base64: string) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    Buffer.from(base64, 'base64') as unknown as Parameters<typeof book.xlsx.load>[0]
  );
  return book.worksheets[0];
}

describe('toXlsxBase64', () => {
  it('writes header, rows, totals and notes with numbers kept numeric', async () => {
    const sheet = await read(await toXlsxBase64(table, 'Sub-goals'));
    expect(sheet.name).toBe('Sub-goals');
    expect(sheet.getRow(1).values).toEqual([undefined, 'Name', 'Cost (USD)']);
    expect(sheet.getRow(2).getCell(2).value).toBe(2.5);
    expect(sheet.getRow(3).getCell(2).value).toBeNull();
    expect(sheet.getRow(4).getCell(1).value).toBe('Total');
    expect(sheet.getRow(4).getCell(2).value).toBe(2.5);
    expect(sheet.getRow(6).getCell(1).value).toBe(table.notes[0]);
  });

  it('formats the header and totals bold and freezes the header row', async () => {
    const sheet = await read(await toXlsxBase64(table, 'Sub-goals'));
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.getRow(4).font?.bold).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('shows cost with two decimals', async () => {
    const sheet = await read(await toXlsxBase64(table, 'Sub-goals'));
    expect(sheet.getRow(2).getCell(2).numFmt).toBe('#,##0.00');
  });
});
