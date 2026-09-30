export const TICKET_USAGE_COLUMNS = ['tokens', 'cost'] as const;
export type TicketUsageColumn = (typeof TICKET_USAGE_COLUMNS)[number];

export const TICKET_USAGE_COLUMN_LABEL: Record<TicketUsageColumn, string> = {
  tokens: 'Tokens',
  cost: 'Cost',
};

/** The stored choice is a JSON list; anything else is "no columns", the default. */
export function parseTicketUsageColumns(raw: string | null): TicketUsageColumn[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return TICKET_USAGE_COLUMNS.filter((column) => parsed.includes(column));
  } catch {
    return [];
  }
}

export function serializeTicketUsageColumns(columns: readonly TicketUsageColumn[]): string {
  return JSON.stringify(columns);
}

export function toggleTicketUsageColumn(
  columns: readonly TicketUsageColumn[],
  column: TicketUsageColumn
): TicketUsageColumn[] {
  const next = columns.includes(column)
    ? columns.filter((c) => c !== column)
    : [...columns, column];
  return TICKET_USAGE_COLUMNS.filter((c) => next.includes(c));
}
