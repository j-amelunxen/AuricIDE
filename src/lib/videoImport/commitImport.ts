import { planToStations } from '@/lib/goals/planner/commitPlan';
import type { PmGoal, PmGoalStation, StationSourceContext } from '@/lib/tauri/goals';
import type { PmDependency, PmEpic, PmTicket } from '@/lib/tauri/pm';
import type { VideoMediaAnalysis } from '@/lib/tauri/videoImport';
import type { ExtractedProcess, TranscriptSegment } from './processExtraction';
import { processToPlannerGraph } from './processExtraction';

interface BuildVideoImportCommitInput {
  process: ExtractedProcess;
  media: VideoMediaAnalysis;
  goalId: string;
  epicId: string;
  stationIds: string[];
  ticketIds: string[];
  dependencyIds: string[];
  now: string;
}

export interface VideoImportCommitIdentity {
  importId: string;
  goalId: string;
  epicId: string;
  stationIds: string[];
  ticketIds: string[];
  dependencyIds: string[];
}

export function reconcileVideoImportCommitIdentity(
  existing: VideoImportCommitIdentity | null,
  importId: string,
  stepCount: number,
  makeId: () => string = () => crypto.randomUUID()
): VideoImportCommitIdentity {
  const ids = existing ?? {
    importId,
    goalId: makeId(),
    epicId: makeId(),
    stationIds: [],
    ticketIds: [],
    dependencyIds: [],
  };
  const fill = (values: string[], count: number) => [
    ...values,
    ...Array.from({ length: Math.max(0, count - values.length) }, makeId),
  ];
  return {
    ...ids,
    importId,
    stationIds: fill(ids.stationIds, stepCount),
    ticketIds: fill(ids.ticketIds, stepCount),
    dependencyIds: fill(ids.dependencyIds, Math.max(0, stepCount - 1)),
  };
}

export interface VideoImportDraftState {
  goals: PmGoal[];
  stations: PmGoalStation[];
  epics: PmEpic[];
  tickets: PmTicket[];
  dependencies: PmDependency[];
}

/** Replaces only rows owned by this import, including stale rows from a shortened retry. */
export function reconcileVideoImportDraftState(
  current: VideoImportDraftState,
  commit: VideoImportCommit,
  identity: VideoImportCommitIdentity
): VideoImportDraftState {
  const stationIds = new Set(identity.stationIds);
  const ticketIds = new Set(identity.ticketIds);
  const dependencyIds = new Set(identity.dependencyIds);
  return {
    goals: [...current.goals.filter((goal) => goal.id !== identity.goalId), commit.goal],
    stations: [
      ...current.stations.filter((station) => !stationIds.has(station.id)),
      ...commit.stations,
    ],
    epics: [...current.epics.filter((epic) => epic.id !== identity.epicId), commit.epic],
    tickets: [...current.tickets.filter((ticket) => !ticketIds.has(ticket.id)), ...commit.tickets],
    dependencies: [
      ...current.dependencies.filter((dependency) => !dependencyIds.has(dependency.id)),
      ...commit.dependencies,
    ],
  };
}

export interface VideoImportCommit {
  goal: PmGoal;
  epic: PmEpic;
  stations: PmGoalStation[];
  tickets: PmTicket[];
  dependencies: PmDependency[];
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
    () => {
      const id = input.stationIds[stationIndex];
      if (!id) throw new Error(`Missing stable station id for imported step ${stationIndex + 1}`);
      stationIndex += 1;
      return id;
    },
    now
  );
  const epic: PmEpic = {
    id: input.epicId,
    name: `Video import · ${process.title}`,
    description: `Executable work imported from ${media.sourceName}. Source: ${media.workspacePath}`,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
  let ticketIndex = 0;
  const tickets: PmTicket[] = [];
  process.steps.forEach((step, index) => {
    const humanOnly = step.actor === 'human' || step.stationKind === 'human';
    const id = input.ticketIds[ticketIndex++];
    if (!id) throw new Error(`Missing stable ticket id for imported step ${index + 1}`);
    tickets.push({
      id,
      epicId: epic.id,
      goalId,
      name: step.title,
      description: [step.description, `Imported from ${media.workspacePath}`]
        .filter(Boolean)
        .join('\n\n'),
      status: 'open',
      statusUpdatedAt: now,
      sortOrder: tickets.length,
      priority: 'normal',
      needsHumanSupervision: humanOnly || step.actor === 'unknown' || step.stationKind === 'gate',
      createdAt: now,
      updatedAt: now,
    });
    stations[index].ticketId = id;
  });
  const dependencies: PmDependency[] = tickets.slice(1).map((ticket, index) => ({
    id:
      input.dependencyIds[index] ??
      (() => {
        throw new Error(`Missing stable dependency id for imported step ${index + 2}`);
      })(),
    sourceType: 'ticket',
    sourceId: ticket.id,
    targetType: 'ticket',
    targetId: tickets[index].id,
  }));
  return { goal, epic, stations, tickets, dependencies, unassignedTranscript };
}
