'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { llmCall } from '@/lib/tauri/llm';
import { getRootGoals } from '@/lib/store/goalsSlice';
import { buildGoalLine } from '@/lib/goals/goalLinesLayout';
import { buildInitialPrompt, buildRefinePrompt } from '@/lib/goals/planner/plannerPrompt';
import {
  parsePlannerGraph,
  parsePlannerOps,
  type PlannerGraph,
} from '@/lib/goals/planner/plannerSchema';
import { applyPlannerOps } from '@/lib/goals/planner/applyPlannerOps';
import { planToStations } from '@/lib/goals/planner/commitPlan';
import {
  deletePlannerDraft,
  loadPlannerDraft,
  savePlannerDraft,
  type PlannerRevision,
} from '@/lib/goals/planner/plannerDraft';
import { useNow } from '@/lib/hooks/useNow';
import { nowTimestamp, stationProblem, withDraftIds } from './plannerHelpers';

export function usePlannerState() {
  const now = useNow();
  const rootPath = useStore((s) => s.rootPath);
  const goalsDraft = useStore((s) => s.goalsDraft);
  const goalStationsDraft = useStore((s) => s.goalStationsDraft);
  const addStation = useStore((s) => s.addStation);
  const deleteStation = useStore((s) => s.deleteStation);
  const updateGoal = useStore((s) => s.updateGoal);
  const saveGoals = useStore((s) => s.saveGoals);
  const setSelectedGoalId = useStore((s) => s.setSelectedGoalId);
  const setGoalLinesOpen = useStore((s) => s.setGoalLinesOpen);
  const setGoalsModalOpen = useStore((s) => s.setGoalsModalOpen);
  const llmConfigured = useStore((s) => s.llmConfigured);

  const [open, setOpen] = useState(false);
  const [goalId, setGoalId] = useState('');
  const [dump, setDump] = useState('');
  const [refine, setRefine] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<PlannerGraph | null>(null);
  const [revisions, setRevisions] = useState<PlannerRevision[]>([]);

  // Only goals without a committed plan are plannable — a line that already
  // has stations is refined on the board, not re-planned from scratch.
  const plannedGoalIds = useMemo(
    () => new Set(goalStationsDraft.map((s) => s.goalId)),
    [goalStationsDraft]
  );
  const plannableGoals = useMemo(
    () =>
      getRootGoals(goalsDraft).filter(
        (g) => g.status !== 'archived' && g.status !== 'achieved' && !plannedGoalIds.has(g.id)
      ),
    [goalsDraft, plannedGoalIds]
  );
  const goal =
    (saving ? goalsDraft.find((candidate) => candidate.id === goalId) : undefined) ??
    plannableGoals.find((candidate) => candidate.id === goalId) ??
    null;

  // Selecting a goal resumes its persisted draft, if one exists.
  useEffect(() => {
    if (!rootPath || !goalId) return;
    let cancelled = false;
    void loadPlannerDraft(rootPath, goalId).then((draft) => {
      if (cancelled || !draft) return;
      setGraph(withDraftIds(draft.graph));
      setRevisions(draft.revisions);
    });
    return () => {
      cancelled = true;
    };
  }, [rootPath, goalId]);

  const persistDraft = useCallback(
    (nextGraph: PlannerGraph, nextRevisions: PlannerRevision[]) => {
      if (rootPath && goalId) {
        void savePlannerDraft(rootPath, goalId, { graph: nextGraph, revisions: nextRevisions });
      }
    },
    [rootPath, goalId]
  );

  const editGraph = useCallback(
    (change: (current: PlannerGraph) => PlannerGraph) => {
      if (!graph) return;
      const next = change(graph);
      setGraph(next);
      persistDraft(next, revisions);
    },
    [graph, persistDraft, revisions]
  );

  const propose = useCallback(async () => {
    if (!goal || !rootPath || !dump.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await llmCall({
        messages: buildInitialPrompt(goal, dump.trim()),
        projectPath: rootPath,
      });
      const parsed = withDraftIds(parsePlannerGraph(response.content));
      setGraph(parsed);
      setRevisions([]);
      persistDraft(parsed, []);
    } catch (e) {
      // The model's bad JSON is a normal event: the error shows verbatim,
      // the previous state stays, Retry is one click.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [goal, rootPath, dump, busy, persistDraft]);

  const applyRefinement = useCallback(async () => {
    if (!goal || !rootPath || !graph || !refine.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await llmCall({
        messages: buildRefinePrompt(graph, refine.trim()),
        projectPath: rootPath,
      });
      const ops = parsePlannerOps(response.content);
      const next = withDraftIds(applyPlannerOps(graph, ops));
      const nextRevisions = [...revisions, { instruction: refine.trim(), at: nowTimestamp() }];
      setGraph(next);
      setRevisions(nextRevisions);
      setRefine('');
      persistDraft(next, nextRevisions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [goal, rootPath, graph, refine, busy, revisions, persistDraft]);

  const reset = useCallback(() => {
    setGraph(null);
    setRevisions([]);
    setDump('');
    setRefine('');
    setError(null);
  }, []);

  const discard = useCallback(() => {
    if (rootPath && goalId) void deletePlannerDraft(rootPath, goalId);
    reset();
  }, [rootPath, goalId, reset]);

  const start = useCallback(async () => {
    if (savingRef.current || !goal || !graph || !rootPath || graph.stations.some(stationProblem))
      return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const priorStatus = goal.status;
    const stations = planToStations(graph, goal.id, () => crypto.randomUUID(), nowTimestamp());
    for (const station of stations) addStation(station);
    if (goal.status === 'draft') updateGoal(goal.id, { status: 'active' });
    try {
      await saveGoals(rootPath);
    } catch (cause) {
      for (const station of stations) deleteStation(station.id);
      if (priorStatus === 'draft') updateGoal(goal.id, { status: priorStatus });
      setError(`Could not save plan: ${(cause as Error).message}. Please try again.`);
      savingRef.current = false;
      setSaving(false);
      return;
    }
    void deletePlannerDraft(rootPath, goal.id);
    setSelectedGoalId(goal.id);
    if (useStore.getState().workPlaceOpen) {
      useStore.getState().setWorkTab('goals');
    } else {
      setGoalLinesOpen(false);
      setGoalsModalOpen(true);
    }
    reset();
    setGoalId('');
    savingRef.current = false;
    setSaving(false);
    setOpen(false);
  }, [
    goal,
    graph,
    rootPath,
    addStation,
    deleteStation,
    updateGoal,
    saveGoals,
    reset,
    setSelectedGoalId,
    setGoalLinesOpen,
    setGoalsModalOpen,
  ]);

  // The preview IS the commit result: same conversion, deterministic ids.
  const previewLine = useMemo(() => {
    if (!goal || !graph) return null;
    let n = 0;
    const stations = planToStations(graph, goal.id, () => `preview-${++n}`, nowTimestamp());
    return buildGoalLine(
      {
        goals: [goal],
        tickets: [],
        dependencies: [],
        requirements: [],
        requirementLinks: [],
        stations,
        runs: [],
        agents: [],
        now,
      },
      goal.id
    );
  }, [goal, graph, now]);
  const validation = graph?.stations.map(stationProblem).find(Boolean) ?? null;

  return {
    llmConfigured,
    open,
    setOpen,
    goalId,
    setGoalId,
    plannableGoals,
    goal,
    graph,
    previewLine,
    dump,
    setDump,
    busy,
    saving,
    error,
    revisions,
    refine,
    setRefine,
    validation,
    propose,
    editGraph,
    applyRefinement,
    reset,
    discard,
    start,
  };
}
