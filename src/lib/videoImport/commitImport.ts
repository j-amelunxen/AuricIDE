import { planToStations } from '@/lib/goals/planner/commitPlan';
import type { PmGoal, PmGoalStation, StationSourceContext } from '@/lib/tauri/goals';
import type { VideoMediaAnalysis } from '@/lib/tauri/videoImport';
import type { ExtractedProcess, TranscriptSegment } from './processExtraction';
import { processToPlannerGraph } from './processExtraction';

interface BuildVideoImportCommitInput {
  process: ExtractedProcess;
  media: VideoMediaAnalysis;
  goalId: string;
  stationIds: string[];
  now: string;
}

export interface VideoImportCommit {
  goal: PmGoal;
  stations: PmGoalStation[];
  unassignedTranscript: TranscriptSegment[];
}

export function buildVideoImportCommit(input: BuildVideoImportCommitInput): VideoImportCommit {
  const { process, media, goalId, now } = input;
  const assignedSegmentIds = new Set(process.steps.flatMap((step) => step.sourceSegmentIds));
  const unassignedTranscript = media.transcript.filter(
    (_, index) => !assignedSegmentIds.has(index)
  );
  const provenanceSummary = [
    process.summary,
    `Video source: ${media.sourcePath}`,
    `Lossless import record: ${media.workspacePath}`,
    process.ambiguities.length > 0
      ? `Ambiguities:\n${process.ambiguities.map((v) => `- ${v}`).join('\n')}`
      : '',
    process.deferredIdeas.length > 0
      ? `Deferred ideas:\n${process.deferredIdeas.map((v) => `- ${v}`).join('\n')}`
      : '',
    unassignedTranscript.length > 0
      ? `Unassigned transcript context remains in the import record (${unassignedTranscript.length} segments).`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const goal: PmGoal = {
    id: goalId,
    parentId: null,
    name: process.title,
    description: provenanceSummary,
    successCriteria: process.successCriteria,
    status: 'active',
    priority: 'normal',
    goalPrompt: `${process.objective}\n\nSource material: ${media.workspacePath}`,
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };

  const graph = processToPlannerGraph(process);
  graph.stations.forEach((station, index) => {
    const step = process.steps[index];
    const sourceSegments = step.sourceSegmentIds.flatMap((segmentId) => {
      const segment = media.transcript[segmentId];
      return segment
        ? [{ startMs: segment.startMs, endMs: segment.endMs, text: segment.text }]
        : [];
    });
    const requestedFrames = step.frameTimestampsMs.flatMap((timestampMs) => {
      const nearest = [...media.frames]
        .sort(
          (left, right) =>
            Math.abs(left.timestampMs - timestampMs) - Math.abs(right.timestampMs - timestampMs)
        )
        .at(0);
      return nearest && Math.abs(nearest.timestampMs - timestampMs) <= 3_000 ? [nearest] : [];
    });
    const contextualFrames =
      requestedFrames.length > 0
        ? requestedFrames
        : media.frames.filter((frame) =>
            sourceSegments.some(
              (segment) =>
                frame.timestampMs >= segment.startMs - 1_000 &&
                frame.timestampMs <= segment.endMs + 1_000
            )
          );
    const uniqueFrames = [
      ...new Map(contextualFrames.map((frame) => [frame.path, frame])).values(),
    ];
    const sourceContext: StationSourceContext = {
      importId: media.importId,
      sourcePath: media.sourcePath,
      transcriptSegments: sourceSegments,
      frames: uniqueFrames.map((frame) => ({ timestampMs: frame.timestampMs, path: frame.path })),
      notes: [step.description].filter(Boolean),
    };
    station.sourceContext = sourceContext;
  });

  let stationIndex = 0;
  const stations = planToStations(
    graph,
    goalId,
    () => input.stationIds[stationIndex++] ?? crypto.randomUUID(),
    now
  );
  return { goal, stations, unassignedTranscript };
}
