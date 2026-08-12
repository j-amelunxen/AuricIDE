import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createTestNotificationsDb,
  dispatchNotification,
  getAnswer,
  NOTIFICATION_CAP,
  type NotificationRow,
} from './notificationsDb';

/**
 * This schema exists twice — here and in `src-tauri/src/notifications.rs`.
 * These tests pin the behaviour the Rust side also guarantees, so a change on
 * one side that is not mirrored shows up as a failure rather than as two
 * processes quietly disagreeing about the same file.
 */

describe('the MCP view of the inbox', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestNotificationsDb();
  });

  const rows = (): NotificationRow[] =>
    db.prepare('SELECT * FROM notifications ORDER BY id').all() as NotificationRow[];

  it('stores a notification with agent defaults', () => {
    const stored = dispatchNotification(db, { title: 'Fertig' });

    expect(stored.title).toBe('Fertig');
    expect(stored.kind).toBe('info');
    expect(stored.severity).toBe('info');
    expect(stored.source).toBe('mcp');
    expect(stored.read_at).toBeNull();
  });

  it('serialises actions as JSON', () => {
    const stored = dispatchNotification(db, {
      title: 'Agent starten?',
      actions: [{ id: 'yes', label: 'Ja', kind: 'answer', value: 'yes' }],
    });

    expect(JSON.parse(stored.actions)).toEqual([
      { id: 'yes', label: 'Ja', kind: 'answer', value: 'yes' },
    ]);
  });

  it('mints distinct uids', () => {
    const a = dispatchNotification(db, { title: 'a' });
    const b = dispatchNotification(db, { title: 'b' });
    expect(a.uid).not.toBe(b.uid);
  });

  describe('deduplication', () => {
    it('replaces the previous row under the same key', () => {
      dispatchNotification(db, { title: 'alt', dedupeKey: 'k' });
      dispatchNotification(db, { title: 'neu', dedupeKey: 'k' });

      expect(rows()).toHaveLength(1);
      expect(rows()[0].title).toBe('neu');
    });

    // An agent polling on the uid it was handed must still find its question.
    it('keeps the uid it replaced', () => {
      const first = dispatchNotification(db, { title: 'alt', dedupeKey: 'k' });
      const second = dispatchNotification(db, { title: 'neu', dedupeKey: 'k' });

      expect(second.uid).toBe(first.uid);
    });

    // Clients drain by row id; reusing the old one would hide the bump.
    it('takes a fresh row id', () => {
      const first = dispatchNotification(db, { title: 'alt', dedupeKey: 'k' });
      const second = dispatchNotification(db, { title: 'neu', dedupeKey: 'k' });

      expect(second.id).toBeGreaterThan(first.id);
    });

    it('leaves rows without a key alone', () => {
      dispatchNotification(db, { title: 'a' });
      dispatchNotification(db, { title: 'b' });
      expect(rows()).toHaveLength(2);
    });
  });

  describe('retention', () => {
    it('keeps an unread backlog past the cap', () => {
      for (let i = 0; i < NOTIFICATION_CAP + 3; i += 1) {
        dispatchNotification(db, { title: `n${i}` });
      }
      expect(rows()).toHaveLength(NOTIFICATION_CAP + 3);
    });

    it('trims read rows back to the cap', () => {
      for (let i = 0; i < NOTIFICATION_CAP; i += 1) {
        const stored = dispatchNotification(db, { title: `n${i}` });
        db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE uid = ?").run(
          stored.uid
        );
      }
      dispatchNotification(db, { title: 'neueste' });

      expect(rows()).toHaveLength(NOTIFICATION_CAP);
    });
  });

  describe('getAnswer', () => {
    it('is pending while nobody has decided', () => {
      const stored = dispatchNotification(db, { title: 'Starten?', kind: 'ask' });
      expect(getAnswer(db, stored.uid)).toEqual({ status: 'pending' });
    });

    it('returns the chosen value once answered', () => {
      const stored = dispatchNotification(db, { title: 'Starten?', kind: 'ask' });
      db.prepare(
        "UPDATE notifications SET answer = 'yes', answered_at = datetime('now') WHERE uid = ?"
      ).run(stored.uid);

      const result = getAnswer(db, stored.uid);

      expect(result.status).toBe('answered');
      expect(result.answer).toBe('yes');
      expect(result.answeredAt).toBeTruthy();
    });

    it('reports an unanswered question past its deadline as expired', () => {
      const stored = dispatchNotification(db, {
        title: 'Starten?',
        kind: 'ask',
        expiresAt: '2000-01-01 00:00:00',
      });

      expect(getAnswer(db, stored.uid).status).toBe('expired');
    });

    // An answer that arrived before the deadline still counts.
    it('prefers a recorded answer over the deadline', () => {
      const stored = dispatchNotification(db, {
        title: 'Starten?',
        kind: 'ask',
        expiresAt: '2000-01-01 00:00:00',
      });
      db.prepare(
        "UPDATE notifications SET answer = 'yes', answered_at = datetime('now') WHERE uid = ?"
      ).run(stored.uid);

      expect(getAnswer(db, stored.uid).status).toBe('answered');
    });

    // Distinct from pending on purpose: a caller polling a cleared row would
    // otherwise wait forever.
    it('says gone when the row no longer exists', () => {
      expect(getAnswer(db, 'never-existed')).toEqual({ status: 'gone' });
    });
  });
});
