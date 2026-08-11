import { describe, expect, it } from 'vitest';
import { buildVideoImportCommit } from './commitImport';

describe('buildVideoImportCommit', () => {
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
      stationIds: ['station-1', 'station-2'],
      now: '2026-08-11 12:00:00',
    });

    expect(result.goal.description).toContain('/project/.auric/video-imports/video-1');
    expect(result.goal.description).toContain('Which dashboard');
    expect(result.goal.description).toContain('Automate delivery');
    expect(result.stations[0].sourceContext?.transcriptSegments[0].text).toBe('Export it');
    expect(result.stations[0].sourceContext?.frames[0].path).toBe('/frames/one.jpg');
    expect(result.stations[1].kind).toBe('human');
    expect(result.unassignedTranscript[0].text).toBe('Some extra context');
  });
});
