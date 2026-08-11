import { describe, expect, it } from 'vitest';
import {
  buildVideoImportCommit,
  reconcileVideoImportCommitIdentity,
  reconcileVideoImportDraftState,
} from './commitImport';

describe('buildVideoImportCommit', () => {
  it('recovers durable ids across reopen and only allocates ids for newly added steps', () => {
    let serial = 0;
    const makeId = () => `new-${++serial}`;
    const first = reconcileVideoImportCommitIdentity(null, 'import-1', 2, makeId);
    const reopened = reconcileVideoImportCommitIdentity(first, 'import-2', 3, makeId);

    expect(reopened.goalId).toBe(first.goalId);
    expect(reopened.epicId).toBe(first.epicId);
    expect(reopened.stationIds.slice(0, 2)).toEqual(first.stationIds);
    expect(reopened.ticketIds.slice(0, 2)).toEqual(first.ticketIds);
    expect(reopened.importId).toBe('import-2');
    expect(reopened.stationIds).toHaveLength(3);
    expect(reopened.dependencyIds).toHaveLength(2);
  });

  it('replaces stale import rows after a partial save and preserves unrelated graph rows', () => {
    let serial = 0;
    const identity = reconcileVideoImportCommitIdentity(null, 'v', 3, () => `id-${++serial}`);
    const base = {
      media: {
        importId: 'v',
        sourcePath: '/v',
        sourceName: 'v',
        durationMs: 0,
        workspacePath: '/w',
        transcriptionProvider: 'local' as const,
        transcript: [],
        frames: [],
      },
      goalId: identity.goalId,
      epicId: identity.epicId,
      stationIds: identity.stationIds,
      ticketIds: identity.ticketIds,
      dependencyIds: identity.dependencyIds,
      now: 'now',
    };
    const step = (title: string) => ({
      title,
      description: '',
      actor: 'agent' as const,
      confidence: 1,
      sourceSegmentIds: [],
      frameTimestampsMs: [],
    });
    const process = (steps: ReturnType<typeof step>[]) => ({
      title: 'Flow',
      objective: 'Flow',
      successCriteria: 'Done',
      summary: '',
      ambiguities: [],
      deferredIdeas: [],
      steps,
    });
    const first = buildVideoImportCommit({
      ...base,
      process: process([step('A'), step('B'), step('C')]),
    });
    const afterPartialSave = reconcileVideoImportDraftState(
      {
        goals: [{ ...first.goal, id: 'unrelated-goal' }],
        stations: [],
        epics: [],
        tickets: [],
        dependencies: [],
      },
      first,
      identity
    );

    // User reopens after the boundary failure, reorders A and deletes B/C.
    const reopenedIdentity = reconcileVideoImportCommitIdentity(identity, 'v-2', 1, () => 'unused');
    const finalCommit = buildVideoImportCommit({
      ...base,
      media: { ...base.media, importId: 'v-2' },
      process: process([step('A final')]),
      stationIds: reopenedIdentity.stationIds,
      ticketIds: reopenedIdentity.ticketIds,
      dependencyIds: reopenedIdentity.dependencyIds,
    });
    const final = reconcileVideoImportDraftState(afterPartialSave, finalCommit, reopenedIdentity);

    expect(final.goals).toHaveLength(2);
    expect(final.goals.some((goal) => goal.id === 'unrelated-goal')).toBe(true);
    expect(final.stations).toEqual([expect.objectContaining({ id: identity.stationIds[0] })]);
    expect(final.tickets).toEqual([
      expect.objectContaining({ id: identity.ticketIds[0], name: 'A final' }),
    ]);
    expect(final.dependencies).toEqual([]);
  });
  it('keeps complete provenance while attaching focused context to every station', () => {
    const result = buildVideoImportCommit({
      process: {
        title: 'Publish report',
        objective: 'Publish it',
        successCriteria: 'Client received it',
        summary: 'Review and publish',
        steps: [
          {
            title: 'Export',
            description: 'Export the draft',
            actor: 'agent',
            confidence: 0.9,
            sourceSegmentIds: [0],
            frameTimestampsMs: [1200],
          },
          {
            title: 'Approve',
            description: 'Client signs off',
            actor: 'human',
            confidence: 0.9,
            sourceSegmentIds: [1],
            frameTimestampsMs: [],
          },
        ],
        ambiguities: ['Which dashboard supplies the data?'],
        deferredIdeas: ['Automate delivery later'],
      },
      media: {
        importId: 'video-1',
        sourcePath: '/video.mp4',
        sourceName: 'video.mp4',
        durationMs: 5000,
        workspacePath: '/project/.auric/video-imports/video-1',
        transcriptionProvider: 'local',
        transcript: [
          { startMs: 0, endMs: 2000, text: 'Export it' },
          { startMs: 2000, endMs: 4000, text: 'Client approves' },
          { startMs: 4000, endMs: 5000, text: 'Some extra context' },
        ],
        frames: [{ timestampMs: 1200, path: '/frames/one.jpg' }],
      },
      goalId: 'goal-1',
      epicId: 'epic-1',
      stationIds: ['station-1', 'station-2'],
      ticketIds: ['ticket-1', 'ticket-2'],
      dependencyIds: ['dependency-1'],
      now: '2026-08-11 12:00:00',
    });

    expect(result.goal.description).toContain('/project/.auric/video-imports/video-1');
    expect(result.goal.description).toContain('Which dashboard');
    expect(result.goal.description).toContain('Automate delivery');
    expect(result.stations[0].sourceContext?.transcriptSegments[0].text).toBe('Export it');
    expect(result.stations[0].sourceContext?.frames[0].path).toBe('/frames/one.jpg');
    expect(result.stations[1].kind).toBe('human');
    expect(result.epic.name).toBe('Video import · Publish report');
    expect(result.tickets).toEqual([
      expect.objectContaining({ id: 'ticket-1', goalId: 'goal-1', epicId: 'epic-1' }),
      expect.objectContaining({
        id: 'ticket-2',
        goalId: 'goal-1',
        needsHumanSupervision: true,
      }),
    ]);
    expect(result.stations[0].ticketId).toBe('ticket-1');
    expect(result.stations[1].ticketId).toBe('ticket-2');
    expect(result.unassignedTranscript[0].text).toBe('Some extra context');
  });

  it('creates ordered dependencies between executable steps across human gates', () => {
    const process = {
      title: 'Release',
      objective: 'Release',
      successCriteria: 'Released',
      summary: '',
      ambiguities: [],
      deferredIdeas: [],
      steps: [
        {
          title: 'Build',
          description: '',
          actor: 'agent' as const,
          confidence: 1,
          sourceSegmentIds: [],
          frameTimestampsMs: [],
        },
        {
          title: 'Approve',
          description: '',
          actor: 'human' as const,
          confidence: 1,
          sourceSegmentIds: [],
          frameTimestampsMs: [],
        },
        {
          title: 'Deploy',
          description: '',
          actor: 'system' as const,
          confidence: 1,
          sourceSegmentIds: [],
          frameTimestampsMs: [],
        },
      ],
    };
    const result = buildVideoImportCommit({
      process,
      media: {
        importId: 'v',
        sourcePath: '/v',
        sourceName: 'v',
        durationMs: 0,
        workspacePath: '/w',
        transcriptionProvider: 'local',
        transcript: [],
        frames: [],
      },
      goalId: 'g',
      epicId: 'e',
      stationIds: ['s1', 's2', 's3'],
      ticketIds: ['t1', 't2', 't3'],
      dependencyIds: ['d1', 'd2'],
      now: 'now',
    });

    expect(result.tickets.map((ticket) => ticket.id)).toEqual(['t1', 't2', 't3']);
    expect(result.tickets[1].needsHumanSupervision).toBe(true);
    expect(result.dependencies).toEqual([
      expect.objectContaining({ id: 'd1', sourceId: 't2', targetId: 't1' }),
      expect.objectContaining({ id: 'd2', sourceId: 't3', targetId: 't2' }),
    ]);
  });

  it('keeps consecutive and terminal human actions as durable ordered tickets', () => {
    const result = buildVideoImportCommit({
      process: {
        title: 'Approve',
        objective: 'Approve',
        successCriteria: 'Approved',
        summary: '',
        ambiguities: [],
        deferredIdeas: [],
        steps: [
          {
            title: 'Legal review',
            description: '',
            actor: 'human',
            confidence: 1,
            sourceSegmentIds: [],
            frameTimestampsMs: [],
          },
          {
            title: 'Owner sign-off',
            description: '',
            actor: 'human',
            stationKind: 'gate',
            confidence: 1,
            sourceSegmentIds: [],
            frameTimestampsMs: [],
          },
        ],
      },
      media: {
        importId: 'v',
        sourcePath: '/v',
        sourceName: 'v',
        durationMs: 0,
        workspacePath: '/w',
        transcriptionProvider: 'local',
        transcript: [],
        frames: [],
      },
      goalId: 'g',
      epicId: 'e',
      stationIds: ['s1', 's2'],
      ticketIds: ['t1', 't2'],
      dependencyIds: ['d1'],
      now: 'now',
    });
    expect(result.stations.map((station) => station.ticketId)).toEqual(['t1', 't2']);
    expect(result.tickets.every((ticket) => ticket.needsHumanSupervision)).toBe(true);
    expect(result.dependencies[0]).toEqual(
      expect.objectContaining({ sourceId: 't2', targetId: 't1' })
    );
  });

  it('refuses to invent ids when the durable identity set is incomplete', () => {
    expect(() =>
      buildVideoImportCommit({
        process: {
          title: 'X',
          objective: 'X',
          successCriteria: 'X',
          summary: '',
          ambiguities: [],
          deferredIdeas: [],
          steps: [
            {
              title: 'X',
              description: '',
              actor: 'agent',
              confidence: 1,
              sourceSegmentIds: [],
              frameTimestampsMs: [],
            },
          ],
        },
        media: {
          importId: 'v',
          sourcePath: '/v',
          sourceName: 'v',
          durationMs: 0,
          workspacePath: '/w',
          transcriptionProvider: 'local',
          transcript: [],
          frames: [],
        },
        goalId: 'g',
        epicId: 'e',
        stationIds: [],
        ticketIds: [],
        dependencyIds: [],
        now: 'now',
      })
    ).toThrow(/stable station id/);
  });
});
