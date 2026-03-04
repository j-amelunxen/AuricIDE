import type Database from 'better-sqlite3';

type ResolvableTable = 'pm_tickets' | 'pm_epics' | 'blueprints';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_PREFIX_LENGTH = 4;

const TABLE_LABELS: Record<ResolvableTable, string> = {
  pm_tickets: 'tickets',
  pm_epics: 'epics',
  blueprints: 'blueprints',
};

/**
 * Resolves a full UUID or unique prefix to a full ID from the given table.
 * - Full UUID (36 chars): returned directly without a DB query.
 * - Prefix (min 4 chars): `SELECT id FROM <table> WHERE id LIKE '<prefix>%'`
 *   - 1 match  -> return the full ID
 *   - 0 matches -> throw
 *   - 2+ matches -> throw (with example IDs)
 */
export function resolveId(db: Database.Database, table: ResolvableTable, prefix: string): string {
  if (UUID_RE.test(prefix)) return prefix;

  const label = TABLE_LABELS[table];

  if (prefix.length < MIN_PREFIX_LENGTH) {
    throw new Error(`ID prefix '${prefix}' is too short (minimum ${MIN_PREFIX_LENGTH} characters)`);
  }

  const rows = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ? || '%'`).all(prefix) as {
    id: string;
  }[];

  if (rows.length === 0) {
    throw new Error(`No ${label} found for ID prefix '${prefix}'`);
  }
  if (rows.length > 1) {
    const examples = rows
      .slice(0, 5)
      .map((r) => r.id)
      .join(', ');
    throw new Error(
      `Ambiguous ID prefix '${prefix}' matches ${rows.length} ${label} (e.g. ${examples})`
    );
  }
  return rows[0].id;
}

export function resolveTicketId(db: Database.Database, prefix: string): string {
  return resolveId(db, 'pm_tickets', prefix);
}

export function resolveEpicId(db: Database.Database, prefix: string): string {
  return resolveId(db, 'pm_epics', prefix);
}

export function resolveBlueprintId(db: Database.Database, prefix: string): string {
  return resolveId(db, 'blueprints', prefix);
}

/**
 * Maps a dependency type string ('ticket' | 'epic') to its DB table name.
 */
export function typeToTable(type: string): ResolvableTable {
  switch (type) {
    case 'ticket':
      return 'pm_tickets';
    case 'epic':
      return 'pm_epics';
    default:
      throw new Error(`Unknown dependency type: '${type}'`);
  }
}
