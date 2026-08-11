import { describe, expect, it } from 'vitest';
import {
  buildProcessExtractionMessages,
  parseExtractedProcess,
  processToPlannerGraph,
} from './processExtraction';

describe('video process extraction', () => {
  it('asks the configured LLM for grounded steps, ambiguities and deferred ideas', () => {
    const messages = buildProcessExtractionMessages({
      transcript: [
        { startMs: 1_000, endMs: 3_000, text: 'First export the report.' },
        { startMs: 3_000, endMs: 5_000, text: 'Then the client approves it.' },
      ],
      frames: [
        { timestampMs: 3_500, path: '/tmp/frame.jpg', dataUrl: 'data:image/jpeg;base64,eA==' },
      ],
      sourceName: 'review.mp4',
    });

    expect(messages[0].content).toContain('deferredIdeas');
    expect(messages[1].content).toContain('[00:01.000–00:03.000]');
    expect(messages[1].content).toContain('First export the report.');
    expect(Array.isArray(messages[1].parts)).toBe(true);
  });

  it('validates and normalizes a process returned by the LLM', () => {
    const process = parseExtractedProcess(`\`\`\`json
      {
        "title": "Publish report",
        "objective": "Publish the approved report",
        "successCriteria": "The client received the approved report",
        "summary": "A short approval workflow",
        "steps": [
          { "title": "Export report", "description": "Export the draft", "actor": "agent", "confidence": 0.92, "sourceSegmentIds": [0], "frameTimestampsMs": [] },
          { "title": "Approve report", "description": "Client approval", "actor": "human", "confidence": 0.88, "sourceSegmentIds": [1], "frameTimestampsMs": [3500] }
        ],
        "ambiguities": [],
        "deferredIdeas": ["Automate delivery later"]
      }
    \`\`\``);

    expect(process.title).toBe('Publish report');
    expect(process.steps[1].actor).toBe('human');
    expect(process.deferredIdeas).toEqual(['Automate delivery later']);
  });

  it('turns reviewed steps into the existing planner graph contract', () => {
    const graph = processToPlannerGraph({
      title: 'Publish report',
      objective: 'Publish it',
      successCriteria: 'Published',
      summary: '',
      steps: [
        {
          title: 'Export report',
          description: '',
          actor: 'agent',
          confidence: 1,
          sourceSegmentIds: [],
          frameTimestampsMs: [],
        },
        {
          title: 'Client approval',
          description: '',
          actor: 'human',
          confidence: 1,
          sourceSegmentIds: [],
          frameTimestampsMs: [],
        },
        {
          title: 'Unclear follow-up',
          description: '',
          actor: 'unknown',
          confidence: 0.4,
          sourceSegmentIds: [],
          frameTimestampsMs: [],
        },
        {
          title: 'Approve release',
          description: '',
          actor: 'human',
          stationKind: 'gate',
          confidence: 1,
          sourceSegmentIds: [],
          frameTimestampsMs: [],
        },
      ],
      ambiguities: [],
      deferredIdeas: [],
    });

    expect(graph.stations).toEqual([
      expect.objectContaining({ name: 'Export report', kind: 'normal' }),
      expect.objectContaining({
        name: 'Client approval',
        kind: 'human',
        evidenceKind: 'human',
        predicate: { type: 'human' },
      }),
      expect.objectContaining({ name: 'Unclear follow-up', fog: true }),
      expect.objectContaining({
        name: 'Approve release',
        kind: 'gate',
        evidenceKind: 'human',
        predicate: { type: 'human' },
      }),
    ]);
  });

  it('rejects empty or malformed model output instead of inventing a process', () => {
    expect(() => parseExtractedProcess('{"title":"No steps","steps":[]}')).toThrow(/steps/);
    expect(() => parseExtractedProcess('not json')).toThrow(/JSON/);
  });
});
