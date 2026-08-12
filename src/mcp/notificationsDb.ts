import Database from 'better-sqlite3';

/**
 * The MCP server's handle on the notification inbox.
 *
 * This is a *different* database from the project one every other tool here
 * uses. The inbox is app-global by design — an agent working in one repo needs
 * to be able to reach the human who is currently looking at another — so it
 * lives in the app data directory and is reached through the
 * `AURIC_NOTIFICATIONS_DB` path the app passes down when it starts this server.
 *
 * Keep the schema in sync with `src-tauri/src/notifications.rs`, migration 1.
 * Same duplication as `db.ts` ↔ `database.rs`, and the same rule: change both
 * or neither.
 */

export const NOTIFICATION_CAP = 1000;

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = (id: number): boolean => {
    const row = db.prepare('SELECT COUNT(*) > 0 AS ok FROM _migrations WHERE id = ?').get(id) as {
      ok: number;
    };
    return row.ok === 1;
  };

  if (!applied(1)) {
    db.exec(`
      CREATE TABLE notifications (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        uid          TEXT NOT NULL UNIQUE,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        project_path TEXT,
        project_name TEXT,
        source       TEXT NOT NULL,
        origin       TEXT,
        kind         TEXT NOT NULL DEFAULT 'info',
        severity     TEXT NOT NULL DEFAULT 'info',
        title        TEXT NOT NULL,
        body         TEXT,
        actions      TEXT NOT NULL DEFAULT '[]',
        dedupe_key   TEXT,
        ref_kind     TEXT,
        ref_id       TEXT,
        read_at      TEXT,
        answered_at  TEXT,
        answer       TEXT,
        expires_at   TEXT
      );
      CREATE INDEX notifications_unread ON notifications(read_at, id DESC);
      CREATE UNIQUE INDEX notifications_dedupe
        ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
    `);
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(1, 'create_notifications');
  }

  // Schedules share this database — they are dispatchers into the same inbox.
  // Mirrors `schedules::run_migrations`, migration 2.
  if (!applied(2)) {
    db.exec(`
      CREATE TABLE schedules (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        enabled         INTEGER NOT NULL DEFAULT 1,
        project_path    TEXT,
        project_name    TEXT,
        spec_kind       TEXT NOT NULL,
        cron_expr       TEXT,
        every_n         INTEGER,
        every_unit      TEXT,
        anchor_at       TEXT,
        time_of_day     TEXT,
        timezone        TEXT NOT NULL DEFAULT 'UTC',
        catch_up        TEXT NOT NULL DEFAULT 'coalesce',
        payload         TEXT NOT NULL DEFAULT '{}',
        last_fired_at   TEXT,
        last_checked_at TEXT,
        next_due_at     TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX schedules_enabled ON schedules(enabled, next_due_at);
    `);
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(2, 'create_schedules');
  }
}

export function openNotificationsDb(path: string): Database.Database {
  const db = new Database(path);
  // WAL because the app writes to this same file from another process.
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

export function createTestNotificationsDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

export interface NotificationRow {
  id: number;
  uid: string;
  created_at: string;
  project_path: string | null;
  project_name: string | null;
  source: string;
  origin: string | null;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  actions: string;
  dedupe_key: string | null;
  ref_kind: string | null;
  ref_id: string | null;
  read_at: string | null;
  answered_at: string | null;
  answer: string | null;
  expires_at: string | null;
}

export interface DispatchInput {
  uid?: string;
  projectPath?: string | null;
  projectName?: string | null;
  source?: string;
  origin?: string | null;
  kind?: 'info' | 'ask';
  severity?: 'info' | 'success' | 'warn' | 'error';
  title: string;
  body?: string | null;
  actions?: unknown[];
  dedupeKey?: string | null;
  refKind?: string | null;
  refId?: string | null;
  expiresAt?: string | null;
}

let uidCounter = 0;

function generateUid(): string {
  uidCounter += 1;
  return `${Date.now()}-${process.pid}-${uidCounter}`;
}

/**
 * Writes one notification and returns the stored row.
 *
 * Mirrors `dispatch_impl` in Rust exactly, including the two subtleties that
 * matter: a `dedupe_key` bump keeps the uid of the row it replaces (so an agent
 * polling that uid does not lose its own question) but takes a **new** row id
 * (so clients that already drained past the old one see it again).
 */
export function dispatchNotification(db: Database.Database, input: DispatchInput): NotificationRow {
  const write = db.transaction((): NotificationRow => {
    const inherited = input.dedupeKey
      ? (
          db.prepare('SELECT uid FROM notifications WHERE dedupe_key = ?').get(input.dedupeKey) as
            { uid: string } | undefined
        )?.uid
      : undefined;

    const uid = input.uid ?? inherited ?? generateUid();

    if (input.dedupeKey) {
      db.prepare('DELETE FROM notifications WHERE dedupe_key = ?').run(input.dedupeKey);
    }
    db.prepare('DELETE FROM notifications WHERE uid = ?').run(uid);

    db.prepare(
      `INSERT INTO notifications
         (uid, project_path, project_name, source, origin, kind, severity,
          title, body, actions, dedupe_key, ref_kind, ref_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uid,
      input.projectPath ?? null,
      input.projectName ?? null,
      input.source ?? 'mcp',
      input.origin ?? null,
      input.kind ?? 'info',
      input.severity ?? 'info',
      input.title,
      input.body ?? null,
      JSON.stringify(input.actions ?? []),
      input.dedupeKey ?? null,
      input.refKind ?? null,
      input.refId ?? null,
      input.expiresAt ?? null
    );

    // Only rows already dealt with are eligible; an unread backlog past the cap
    // is kept, because a count that disagrees with the list is worse than a
    // long list.
    db.prepare(
      `DELETE FROM notifications WHERE id IN (
         SELECT id FROM notifications
         WHERE read_at IS NOT NULL AND (kind <> 'ask' OR answered_at IS NOT NULL)
         ORDER BY id ASC
         LIMIT MAX(0, (SELECT COUNT(*) FROM notifications) - ?)
       )`
    ).run(NOTIFICATION_CAP);

    return db.prepare('SELECT * FROM notifications WHERE uid = ?').get(uid) as NotificationRow;
  });

  return write();
}

export type AnswerStatus = 'pending' | 'answered' | 'expired' | 'gone';

export interface AnswerResult {
  status: AnswerStatus;
  answer?: string;
  answeredAt?: string;
}

/**
 * Reads back what the human decided.
 *
 * `gone` is distinct from `pending` on purpose: a caller that polls forever on
 * a notification the user cleared would hang, so a missing row is reported as
 * such rather than as "not yet".
 */
export function getAnswer(db: Database.Database, uid: string): AnswerResult {
  const row = db
    .prepare('SELECT answer, answered_at, expires_at FROM notifications WHERE uid = ?')
    .get(uid) as
    { answer: string | null; answered_at: string | null; expires_at: string | null } | undefined;

  if (!row) return { status: 'gone' };
  if (row.answered_at !== null && row.answer !== null) {
    return { status: 'answered', answer: row.answer, answeredAt: row.answered_at };
  }

  // Single quotes: SQLite reads "now" as an identifier, not a string.
  const expired =
    row.expires_at !== null &&
    (db.prepare("SELECT ? <= datetime('now') AS past").get(row.expires_at) as { past: number })
      .past === 1;

  return { status: expired ? 'expired' : 'pending' };
}

export interface ScheduleRow {
  id: string;
  name: string;
  enabled: number;
  project_path: string | null;
  spec_kind: string;
  cron_expr: string | null;
  every_n: number | null;
  every_unit: string | null;
  anchor_at: string | null;
  time_of_day: string | null;
  timezone: string;
  catch_up: string;
  payload: string;
  next_due_at: string | null;
}

export interface CreateScheduleInput {
  name: string;
  projectPath?: string | null;
  projectName?: string | null;
  specKind: 'cron' | 'every';
  cronExpr?: string | null;
  everyN?: number | null;
  everyUnit?: 'hour' | 'day' | 'week' | null;
  anchorAt?: string | null;
  timeOfDay?: string | null;
  timezone?: string;
  catchUp?: 'coalesce' | 'skip' | 'all';
  payload?: unknown;
}

let scheduleCounter = 0;

/**
 * Creates a reminder on the human's behalf.
 *
 * `created_at` defaults to now, which is also the floor the runner uses — so a
 * schedule an agent sets with an anchor in the past cannot replay history the
 * user never asked to hear about.
 */
export function createSchedule(db: Database.Database, input: CreateScheduleInput): ScheduleRow {
  scheduleCounter += 1;
  const id = `mcp-${Date.now()}-${process.pid}-${scheduleCounter}`;

  db.prepare(
    `INSERT INTO schedules
       (id, name, project_path, project_name, spec_kind, cron_expr, every_n, every_unit,
        anchor_at, time_of_day, timezone, catch_up, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.projectPath ?? null,
    input.projectName ?? null,
    input.specKind,
    input.cronExpr ?? null,
    input.everyN ?? null,
    input.everyUnit ?? null,
    input.anchorAt ?? null,
    input.timeOfDay ?? null,
    input.timezone ?? 'UTC',
    input.catchUp ?? 'coalesce',
    JSON.stringify(input.payload ?? {})
  );

  return db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow;
}

export function listSchedules(db: Database.Database): ScheduleRow[] {
  return db.prepare('SELECT * FROM schedules ORDER BY name COLLATE NOCASE').all() as ScheduleRow[];
}

/** Returns whether a row was actually removed, so the caller can say so. */
export function deleteSchedule(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0;
}
