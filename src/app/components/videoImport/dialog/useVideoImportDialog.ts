'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { dbGet, dbSet } from '@/lib/tauri/db';
import { readFileBase64 } from '@/lib/tauri/fs';
import { llmCall } from '@/lib/tauri/llm';
import {
  analyzeVideoMedia,
  saveVideoProcessAnalysis,
  type VideoMediaAnalysis,
} from '@/lib/tauri/videoImport';
import {
  buildProcessExtractionMessages,
  parseExtractedProcess,
  type ExtractedProcess,
} from '@/lib/videoImport/processExtraction';
import {
  buildVideoImportCommit,
  reconcileVideoImportCommitIdentity,
  reconcileVideoImportDraftState,
  type VideoImportCommitIdentity,
} from '@/lib/videoImport/commitImport';
import { parseToolFailure, type ToolFailure } from '@/lib/videoImport/toolFailure';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { ACCEPTED_VIDEO, timestamp, type DialogStage } from './types';

export function useVideoImportDialog() {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const dropRef = useRef<HTMLDivElement>(null);
  const rootPath = useStore((s) => s.rootPath);
  const setOpen = useStore((s) => s.setVideoImportDialogOpen);
  const savePmData = useStore((s) => s.savePmData);
  const saveGoals = useStore((s) => s.saveGoals);
  const startConductor = useStore((s) => s.startConductor);
  const showToast = useStore((s) => s.showToast);
  const { confirm, confirmDialog } = useConfirm();

  const [stage, setStage] = useState<DialogStage>('select');
  const [sourcePath, setSourcePath] = useState('');
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState('Preparing video...');
  const [media, setMedia] = useState<VideoMediaAnalysis | null>(null);
  const [process, setProcess] = useState<ExtractedProcess | null>(null);
  const [error, setError] = useState<ToolFailure | null>(null);
  const [runAfterCreate, setRunAfterCreate] = useState(false);
  const [stepKeys, setStepKeys] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [focusRequest, setFocusRequest] = useState<{ key: string; nonce: number } | null>(null);
  const stepTitleRefs = useRef(new Map<string, HTMLInputElement>());
  const commitIds = useRef<VideoImportCommitIdentity | null>(null);
  const analyzeRunId = useRef(0);

  const close = useCallback(() => {
    if (stage === 'analyzing' || stage === 'saving') return;
    setOpen(false);
  }, [setOpen, stage]);

  const cancelAnalysis = () => {
    if (stage !== 'analyzing') return;
    analyzeRunId.current += 1;
    setStage('select');
    setProgress('Preparing video...');
    setError(null);
  };

  useOverlayLayer({
    id: 'video-import',
    kind: 'tool',
    active: true,
    onEscape: close,
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === 'enter' || payload.type === 'over') setDragging(true);
          else if (payload.type === 'leave') setDragging(false);
          else if (payload.type === 'drop') {
            setDragging(false);
            const path = payload.paths.find((candidate) => ACCEPTED_VIDEO.test(candidate));
            if (path) {
              setSourcePath(path);
              setError(null);
            } else if (payload.paths.length > 0) {
              setError(parseToolFailure('Choose an MP4, MOV, MKV, WEBM or M4V video.'));
            }
          }
        });
        if (disposed) un();
        else unlisten = un;
      } catch {
        // Browser mode still supports the file picker button.
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const chooseVideo = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      title: 'Import process from video',
      multiple: false,
      directory: false,
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v'] }],
    });
    if (typeof selected === 'string') {
      setSourcePath(selected);
      setError(null);
    }
  };

  const analyze = async () => {
    if (!rootPath || !sourcePath || stage === 'analyzing') return;
    const runId = ++analyzeRunId.current;
    setStage('analyzing');
    setError(null);
    try {
      setProgress('Transcribing…');
      const analyzed = await analyzeVideoMedia(rootPath, sourcePath);
      if (runId !== analyzeRunId.current) return;
      setMedia(analyzed);

      setProgress('Analyzing transcript + frames…');
      const visionEnabled =
        (await dbGet(rootPath, 'video_import_settings', 'vision_enabled')) !== 'false';
      if (runId !== analyzeRunId.current) return;
      const frames = await Promise.all(
        analyzed.frames.map(async (frame, index) => {
          if (!visionEnabled || index >= 12) return frame;
          try {
            return {
              ...frame,
              dataUrl: `data:image/jpeg;base64,${await readFileBase64(frame.path)}`,
            };
          } catch {
            return frame;
          }
        })
      );
      if (runId !== analyzeRunId.current) return;
      const response = await llmCall({
        projectPath: rootPath,
        temperature: 0.1,
        maxTokens: 8_000,
        messages: buildProcessExtractionMessages({
          transcript: analyzed.transcript,
          frames,
          sourceName: analyzed.sourceName,
        }),
      });
      if (runId !== analyzeRunId.current) return;
      const extracted = parseExtractedProcess(response.content, {
        transcriptLength: analyzed.transcript.length,
      });
      setStepKeys(extracted.steps.map(() => crypto.randomUUID()));
      const savedIds = await dbGet(rootPath, 'video_import_commit_ids', analyzed.sourcePath);
      if (runId !== analyzeRunId.current) return;
      if (savedIds) {
        try {
          commitIds.current = JSON.parse(savedIds);
        } catch {
          commitIds.current = null;
        }
      }
      setProcess(extracted);
      setStage('review');
    } catch (reason) {
      if (runId !== analyzeRunId.current) return;
      setError(parseToolFailure(reason));
      setStage('select');
    }
  };

  useEffect(() => {
    if (!focusRequest) return;
    stepTitleRefs.current.get(focusRequest.key)?.focus();
  }, [focusRequest]);

  const updateStep = (index: number, changes: Partial<ExtractedProcess['steps'][number]>) => {
    setProcess((current) =>
      current
        ? {
            ...current,
            steps: current.steps.map((step, stepIndex) =>
              stepIndex === index ? { ...step, ...changes } : step
            ),
          }
        : current
    );
  };

  const moveStep = (index: number, offset: -1 | 1) => {
    setProcess((current) => {
      if (!current) return current;
      const target = index + offset;
      if (target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      setStepKeys((keys) => {
        const next = [...keys];
        [next[index], next[target]] = [next[target], next[index]];
        setFocusRequest({ key: next[target], nonce: Date.now() });
        return next;
      });
      setAnnouncement(`Moved ${current.steps[index].title} to position ${target + 1}`);
      return { ...current, steps };
    });
  };

  const deleteStep = (index: number) => {
    const deleted = process?.steps[index];
    if (!process || !deleted || process.steps.length === 1) return;
    const nextKeys = stepKeys.filter((_, i) => i !== index);
    setStepKeys(nextKeys);
    setProcess({ ...process, steps: process.steps.filter((_, i) => i !== index) });
    setFocusRequest({ key: nextKeys[Math.min(index, nextKeys.length - 1)], nonce: Date.now() });
    setAnnouncement(`Deleted ${deleted.title}`);
  };

  const addStep = () => {
    const key = crypto.randomUUID();
    setStepKeys((keys) => [...keys, key]);
    setProcess((current) =>
      current
        ? {
            ...current,
            steps: [
              ...current.steps,
              {
                title: 'New step',
                description: '',
                actor: 'agent',
                stationKind: 'normal',
                confidence: 1,
                sourceSegmentIds: [],
                frameTimestampsMs: [],
              },
            ],
          }
        : current
    );
    setFocusRequest({ key, nonce: Date.now() });
    setAnnouncement(`Added step ${(process?.steps.length ?? 0) + 1}`);
  };

  const commit = async () => {
    if (!rootPath || !media || !process || stage === 'saving') return;
    if (runAfterCreate) {
      const go = await confirm({
        title: 'Start the conductor?',
        message:
          'Create and run will spawn agents for these tickets. They can edit files and run commands.',
        confirmLabel: 'Create and run',
        variant: 'elevate',
      });
      if (!go) return;
    }
    setStage('saving');
    setError(null);
    try {
      commitIds.current = reconcileVideoImportCommitIdentity(
        commitIds.current,
        media.importId,
        process.steps.length
      );
      const ids = commitIds.current;
      await dbSet(rootPath, 'video_import_commit_ids', media.sourcePath, JSON.stringify(ids));
      const built = buildVideoImportCommit({
        process,
        media,
        ...ids,
        now: timestamp(),
      });
      await saveVideoProcessAnalysis(rootPath, media.importId, {
        status: 'pending',
        reviewedProcess: process,
        commitIdentity: ids,
        completeTranscript: media.transcript,
        allFrames: media.frames,
        sourcePath: media.sourcePath,
        workspacePath: media.workspacePath,
      });
      const current = useStore.getState();
      const reconciled = reconcileVideoImportDraftState(
        {
          goals: current.goalsDraft,
          stations: current.goalStationsDraft,
          epics: current.pmDraftEpics,
          tickets: current.pmDraftTickets,
          dependencies: current.pmDraftDependencies,
        },
        built,
        ids
      );
      useStore.setState({
        goalsDraft: reconciled.goals,
        goalStationsDraft: reconciled.stations,
        goalsDirty: true,
        pmDraftEpics: reconciled.epics,
        pmDraftTickets: reconciled.tickets,
        pmDraftDependencies: reconciled.dependencies,
        pmDirty: true,
      });
      // PM first means a failed goal save leaves harmless, retryable orphan work instead of a
      // conductor-visible goal that points at tickets which do not exist yet.
      await savePmData(rootPath);
      await saveGoals(rootPath);
      await saveVideoProcessAnalysis(rootPath, media.importId, {
        status: 'committed',
        reviewedProcess: process,
        goalId: built.goal.id,
        epicId: built.epic.id,
        stationIds: built.stations.map((station) => station.id),
        ticketIds: built.tickets.map((ticket) => ticket.id),
        dependencyIds: built.dependencies.map((dependency) => dependency.id),
        unassignedTranscript: built.unassignedTranscript,
        completeTranscript: media.transcript,
        allFrames: media.frames,
        sourcePath: media.sourcePath,
        workspacePath: media.workspacePath,
      });
      setOpen(false);
      if (runAfterCreate) startConductor(built.goal.id);
      else useStore.getState().openWorkPlace('lines');
      showToast(
        `Created “${built.goal.name}” with ${built.tickets.length} executable tickets${runAfterCreate ? ' and started it' : ''}`,
        'success'
      );
    } catch (reason) {
      setError(parseToolFailure(reason));
      setStage('review');
    }
  };

  const assignedIds = useMemo(
    () => new Set(process?.steps.flatMap((step) => step.sourceSegmentIds) ?? []),
    [process]
  );
  const unassignedCount = media
    ? media.transcript.filter((_, index) => !assignedIds.has(index)).length
    : 0;

  return {
    dialogRef,
    dropRef,
    confirmDialog,
    stage,
    setStage,
    sourcePath,
    dragging,
    progress,
    media,
    process,
    setProcess,
    error,
    runAfterCreate,
    setRunAfterCreate,
    stepKeys,
    announcement,
    stepTitleRefs,
    close,
    cancelAnalysis,
    chooseVideo,
    analyze,
    commit,
    updateStep,
    moveStep,
    deleteStep,
    addStep,
    unassignedCount,
  };
}
