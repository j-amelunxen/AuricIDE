'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';
import {
  GOAL_TABLE_COLUMNS,
  GOAL_TABLE_COLUMN_LABEL,
  buildGoalTable,
  parseGoalTableColumns,
  serializeGoalTableColumns,
  toggleGoalTableColumn,
  type GoalTableCell,
  type GoalTableColumn,
} from '@/lib/goals/goalTable';
import { exportGoalTable, type GoalTableExportFormat } from '@/lib/goals/exportGoalTable';
import { goalsLoadStatusHistory } from '@/lib/tauri/goalHistory';
import type { GoalHistoryEntry } from '@/lib/pm/metrics/goalMetrics';
import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import { useProjectUsageRows } from '@/app/components/pm/cost/useProjectUsageRows';
import { GOAL_STATUS_STYLES } from './GoalTree';

export interface GoalTableProps {
  goal: PmGoal;
  goals: readonly PmGoal[];
  tickets: readonly PmTicket[];
  stations: readonly PmGoalStation[];
  onSelect: (id: string) => void;
}

const EMPTY = '—';
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function display(column: GoalTableColumn, cell: GoalTableCell): string {
  if (cell === null) return EMPTY;
  if (column === 'status')
    return GOAL_STATUS_STYLES[cell as PmGoal['status']]?.label ?? String(cell);
  if (column === 'cost' && typeof cell === 'number') return usd.format(cell);
  if (typeof cell === 'number') return cell.toLocaleString('en-US');
  return cell;
}

/** Sub-goal timing is read from the history table; nothing else needs it. */
function useGoalHistory(columns: readonly GoalTableColumn[]): GoalHistoryEntry[] {
  const rootPath = useStore((s) => s.rootPath);
  const [history, setHistory] = useState<GoalHistoryEntry[]>([]);
  const needed = columns.some((c) => c === 'leadTime' || c === 'cycleTime' || c === 'reviewRounds');

  useEffect(() => {
    if (!needed || !rootPath) return;
    let current = true;
    goalsLoadStatusHistory(rootPath)
      .then((entries) => current && setHistory(entries))
      .catch(() => current && setHistory([]));
    return () => {
      current = false;
    };
  }, [needed, rootPath]);

  return history;
}

const buttonCls =
  'rounded-md border border-white/10 px-2.5 py-1 text-xs text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-50';

/** A parent goal's sub-goals as a table: pick the columns, export what you see. */
export function GoalTable({ goal, goals, tickets, stations, onSelect }: GoalTableProps) {
  const showToast = useStore((s) => s.showToast);
  const usageRows = useProjectUsageRows();
  const [columns, setColumns] = useState<GoalTableColumn[]>(() =>
    parseGoalTableColumns(readAppPref(APP_CONFIG_KEYS.goalTableColumns))
  );
  const [exporting, setExporting] = useState<GoalTableExportFormat | null>(null);
  const history = useGoalHistory(columns);

  const table = useMemo(
    () =>
      buildGoalTable({ parentId: goal.id, goals, tickets, stations, usageRows, history, columns }),
    [goal.id, goals, tickets, stations, usageRows, history, columns]
  );

  const toggle = (column: GoalTableColumn) => {
    const next = toggleGoalTableColumn(columns, column);
    setColumns(next);
    writeAppPref(APP_CONFIG_KEYS.goalTableColumns, serializeGoalTableColumns(next));
  };

  const handleExport = async (format: GoalTableExportFormat) => {
    setExporting(format);
    try {
      const path = await exportGoalTable(table, format, goal.name);
      if (path)
        showToast(`Exported ${table.rows.length} sub-goals as ${format.toUpperCase()}`, 'success');
    } catch (err) {
      showToast(
        typeof err === 'string' ? err : `Could not export as ${format.toUpperCase()}`,
        'error'
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="goal-table">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-2">
        <span id="goal-table-columns-label" className="text-xs text-foreground-muted">
          Columns
        </span>
        <div
          role="group"
          aria-labelledby="goal-table-columns-label"
          className="flex flex-wrap gap-1"
        >
          {GOAL_TABLE_COLUMNS.map((column) => {
            const on = columns.includes(column);
            return (
              <button
                key={column}
                type="button"
                aria-pressed={on}
                disabled={on && columns.length === 1}
                title={on && columns.length === 1 ? 'At least one column stays on' : undefined}
                onClick={() => toggle(column)}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed ${
                  on
                    ? 'border-primary/40 bg-primary/15 text-primary-light'
                    : 'border-white/10 text-foreground-muted hover:bg-white/10'
                }`}
              >
                {GOAL_TABLE_COLUMN_LABEL[column]}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex gap-1.5">
          {(['csv', 'xlsx'] as const).map((format) => (
            <button
              key={format}
              type="button"
              data-testid={`goal-table-export-${format}`}
              disabled={exporting !== null || table.rows.length === 0}
              onClick={() => void handleExport(format)}
              className={buttonCls}
            >
              {exporting === format ? 'Exporting…' : `Export ${format.toUpperCase()}`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3">
        {table.rows.length === 0 ? (
          <p className="text-sm text-foreground-muted">This goal has no sub-goals yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Sub-goals of {goal.name}</caption>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    className={`border-b border-white/10 px-2 py-1.5 text-xs font-medium text-foreground-muted ${
                      c.numeric ? 'text-right' : 'text-left'
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.goalId} className="border-b border-white/5 hover:bg-white/5">
                  {row.cells.map((cell, i) => {
                    const c = table.columns[i];
                    return (
                      <td
                        key={c.id}
                        className={`px-2 py-1.5 tabular-nums ${c.numeric ? 'text-right' : ''}`}
                      >
                        {c.id === 'name' ? (
                          <button
                            type="button"
                            onClick={() => onSelect(row.goalId)}
                            className="text-left text-foreground hover:underline"
                          >
                            {display(c.id, cell)}
                          </button>
                        ) : (
                          display(c.id, cell)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                {table.totals.map((cell, i) => {
                  const c = table.columns[i];
                  return (
                    <td
                      key={c.id}
                      className={`border-t border-white/10 px-2 py-1.5 tabular-nums ${
                        c.numeric ? 'text-right' : ''
                      }`}
                    >
                      {cell === null ? '' : display(c.id, cell)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        )}
        {table.notes.map((note) => (
          <p key={note} className="mt-2 text-xs text-foreground-muted">
            {note}
          </p>
        ))}
      </div>
    </div>
  );
}
