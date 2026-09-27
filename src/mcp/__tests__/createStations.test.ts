import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { FastMCP } from 'fastmcp';
import { createGoal } from '../tools/goals';
import { createTicket } from '../tools/tickets';
import { createEpic } from '../tools/epics';
import {
  createStation,
  createStations,
  listStations,
  registerStationTools,
} from '../tools/stations';
import { createTestDb } from '../db';

interface CapturedTool {
  name: string;
  parameters: { parse: (input: unknown) => unknown };
  execute: (args: unknown) => Promise<string>;
}

/** The create_stations tool exactly as an MCP client reaches it: zod schema, then execute. */
function captureTool(db: Database.Database, name: string): CapturedTool {
  const addTool = vi.spyOn(FastMCP.prototype, 'addTool').mockImplementation(() => undefined);
  registerStationTools(new FastMCP({ name: 'test', version: '0.0.0' }), db);
  const tool = addTool.mock.calls
    .map(([t]) => t as unknown as CapturedTool)
    .find((t) => t.name === name);
  addTool.mockRestore();
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

async function callTool(tool: CapturedTool, input: unknown): Promise<unknown> {
  return JSON.parse(await tool.execute(tool.parameters.parse(input)));
}

const VALID_GLOB = '{"type":"file_exists","glob":"docs/report.md"}';

describe('create_stations: many stations in one call, validated like create_station', () => {
  let db: Database.Database;
  let goalId: string;

  beforeEach(() => {
    db = createTestDb();
    goalId = createGoal(db, { name: 'Ship the feature' }, 'mcp').id;
  });

  afterEach(() => {
    db.close();
  });

  it('creates every station in the given order with dense sort orders', () => {
    const rows = createStations(db, {
      goalId,
      stations: [
        { name: 'Build', predicate: VALID_GLOB },
        { name: 'Review', kind: 'gate' },
        { name: 'Call the client', kind: 'human' },
      ],
    });
    expect(rows.map((r) => r.name)).toEqual(['Build', 'Review', 'Call the client']);
    const stored = listStations(db, goalId);
    expect(stored.map((r) => r.name)).toEqual(['Build', 'Review', 'Call the client']);
    expect(stored.map((r) => r.sort_order)).toEqual([0, 1, 2]);
    expect(JSON.parse(stored[0].predicate)).toEqual({
      type: 'file_exists',
      glob: 'docs/report.md',
    });
    expect(JSON.parse(stored[1].predicate)).toEqual({ type: 'undefined' });
    expect(stored.every((r) => r.status === 'planned')).toBe(true);
  });

  it('stores exactly what the same stations would store through create_station', () => {
    const specs = [
      { name: 'Build', predicate: VALID_GLOB },
      { name: 'Sign off', kind: 'human', predicate: VALID_GLOB },
      { name: 'Gate', kind: 'gate', predicate: '{"type":"git_touches","pathPrefix":"src/"}' },
    ];
    const other = createGoal(db, { name: 'Twin' }, 'mcp').id;
    createStations(db, { goalId, stations: specs });
    for (const s of specs) createStation(db, { goalId: other, ...s });
    const shape = (id: string) =>
      listStations(db, id).map((r) => [r.name, r.kind, r.evidence_kind, r.predicate, r.sort_order]);
    expect(shape(goalId)).toEqual(shape(other));
  });

  it('a human station never keeps a machine predicate an agent could clear', () => {
    const [row] = createStations(db, {
      goalId,
      stations: [{ name: 'Sign off', kind: 'human', predicate: VALID_GLOB }],
    });
    expect(row.evidence_kind).toBe('human');
    expect(JSON.parse(row.predicate)).toEqual({ type: 'human' });
  });

  it('inserts the whole block after a given station, keeping its order', () => {
    const a = createStation(db, { goalId, name: 'A' });
    createStation(db, { goalId, name: 'D' });
    createStations(db, {
      goalId,
      afterStationId: a.id,
      stations: [{ name: 'B' }, { name: 'C' }],
    });
    const stored = listStations(db, goalId);
    expect(stored.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(stored.map((r) => r.sort_order)).toEqual([0, 1, 2, 3]);
  });

  it('appends behind stations that already exist', () => {
    createStation(db, { goalId, name: 'Existing' });
    createStations(db, { goalId, stations: [{ name: 'New 1' }, { name: 'New 2' }] });
    expect(listStations(db, goalId).map((r) => r.name)).toEqual(['Existing', 'New 1', 'New 2']);
  });

  describe('all or nothing', () => {
    it('an invalid glob in the middle writes nothing and names the entry', () => {
      createStation(db, { goalId, name: 'Existing' });
      expect(() =>
        createStations(db, {
          goalId,
          stations: [
            { name: 'First', predicate: VALID_GLOB },
            { name: 'Broken', predicate: '{"type":"file_exists","glob":"**"}' },
            { name: 'Third', predicate: VALID_GLOB },
          ],
        })
      ).toThrow(/stations\[1\]\.predicate\.glob "\*\*" matches every path/);
      expect(listStations(db, goalId).map((r) => r.name)).toEqual(['Existing']);
    });

    it.each([
      ['unknown predicate type', '{"type":"telepathy"}', /stations\[2\]\.predicate\.type/],
      ['missing required field', '{"type":"git_touches"}', /stations\[2\]\.predicate.*pathPrefix/],
      ['not JSON', 'not json', /stations\[2\]\.predicate must be valid JSON/],
      ['file_exists without glob', '{"type":"file_exists"}', /stations\[2\]\.predicate.*glob/],
    ])('rejects the last entry (%s) and writes nothing', (_label, predicate, message) => {
      expect(() =>
        createStations(db, {
          goalId,
          stations: [{ name: 'A' }, { name: 'B' }, { name: 'C', predicate }],
        })
      ).toThrow(message);
      expect(listStations(db, goalId)).toEqual([]);
    });

    it('rejects an unknown kind with the entry index and writes nothing', () => {
      expect(() =>
        createStations(db, {
          goalId,
          stations: [{ name: 'A' }, { name: 'B', kind: 'optional' }],
        })
      ).toThrow(/stations\[1\]\.kind/);
      expect(listStations(db, goalId)).toEqual([]);
    });

    it('rejects an unknown ticket with the entry index and writes nothing', () => {
      expect(() =>
        createStations(db, {
          goalId,
          stations: [{ name: 'A' }, { name: 'B', ticketId: 'no-such-ticket' }],
        })
      ).toThrow(/stations\[1\]\.ticketId/);
      expect(listStations(db, goalId)).toEqual([]);
    });

    it('rejects an unknown afterStationId and writes nothing', () => {
      expect(() =>
        createStations(db, {
          goalId,
          afterStationId: 'no-such-station',
          stations: [{ name: 'A' }],
        })
      ).toThrow(/not found/);
      expect(listStations(db, goalId)).toEqual([]);
    });

    it('rejects an empty list instead of reporting success for nothing', () => {
      expect(() => createStations(db, { goalId, stations: [] })).toThrow(/at least one/);
    });

    // Fault injection: validation passes, the database itself fails on the
    // third insert. The first two rows must roll back with it.
    it('rolls back rows already inserted when the database fails mid-batch', () => {
      createStation(db, { goalId, name: 'Existing' });
      db.exec(`
        CREATE TRIGGER fail_third BEFORE INSERT ON pm_goal_stations
        WHEN NEW.name = 'Third'
        BEGIN SELECT RAISE(ABORT, 'injected disk failure'); END;
      `);
      expect(() =>
        createStations(db, {
          goalId,
          stations: [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }],
        })
      ).toThrow(/injected disk failure/);
      const stored = listStations(db, goalId);
      expect(stored.map((r) => r.name)).toEqual(['Existing']);
      expect(stored.map((r) => r.sort_order)).toEqual([0]);
    });
  });

  it('links a ticket resolved by prefix', () => {
    const epicId = createEpic(db, { name: 'Epic' }).id;
    const ticket = createTicket(db, { epicId, name: 'Wrapped work' });
    const [row] = createStations(db, {
      goalId,
      stations: [{ name: 'Wrap', ticketId: ticket.id.slice(0, 8) }],
    });
    expect(row.ticket_id).toBe(ticket.id);
  });
});

describe('create_stations over MCP: the contract a client sees', () => {
  let db: Database.Database;
  let goalId: string;
  let tool: CapturedTool;

  beforeEach(() => {
    db = createTestDb();
    goalId = createGoal(db, { name: 'Ship the feature' }, 'mcp').id;
    tool = captureTool(db, 'create_stations');
  });

  afterEach(() => {
    db.close();
  });

  it('accepts a goal id prefix and returns the created rows in order', async () => {
    const result = (await callTool(tool, {
      goalId: goalId.slice(0, 8),
      stations: [
        { name: 'Build', predicate: VALID_GLOB },
        { name: 'Approve', kind: 'gate' },
      ],
    })) as { name: string; goal_id: string }[];
    expect(result.map((r) => r.name)).toEqual(['Build', 'Approve']);
    expect(result.every((r) => r.goal_id === goalId)).toBe(true);
  });

  it('an invalid glob in the middle fails the call and leaves the goal untouched', async () => {
    await expect(
      callTool(tool, {
        goalId,
        stations: [
          { name: 'First', predicate: VALID_GLOB },
          { name: 'Broken', predicate: '{"type":"file_exists","glob":"*/**"}' },
          { name: 'Third' },
        ],
      })
    ).rejects.toThrow(/stations\[1\]\.predicate\.glob/);
    expect(listStations(db, goalId)).toEqual([]);
  });

  it('the schema refuses an empty list and an entry without a name', () => {
    expect(() => tool.parameters.parse({ goalId, stations: [] })).toThrow();
    expect(() => tool.parameters.parse({ goalId, stations: [{ name: '' }] })).toThrow();
    expect(() => tool.parameters.parse({ goalId, stations: [{ name: 'A', kind: 'x' }] })).toThrow();
  });

  it('refuses the call for a goal that does not exist', async () => {
    await expect(
      callTool(tool, { goalId: 'no-such-goal', stations: [{ name: 'A' }] })
    ).rejects.toThrow(/no goals found/i);
  });
});
