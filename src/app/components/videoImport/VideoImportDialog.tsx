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
  type ProcessActor,
  type ProcessStationKind,
} from '@/lib/videoImport/processExtraction';
import {
  buildVideoImportCommit,
  reconcileVideoImportCommitIdentity,
  reconcileVideoImportDraftState,
  type VideoImportCommitIdentity,
} from '@/lib/videoImport/commitImport';
import { parseToolFailure, type ToolFailure } from '@/lib/videoImport/toolFailure';
import { ToolFailureNotice } from './ToolFailureNotice';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { useConfirm } from '@/lib/hooks/useConfirm';

type DialogStage = 'select' | 'analyzing' | 'review' | 'saving';

const ACCEPTED_VIDEO = /\.(mp4|mov|mkv|webm|m4v)$/i;
const ACTORS: Array<{ value: ProcessActor; label: string }> = [
  { value: 'agent', label: 'Agent' },
  { value: 'human', label: 'Human' },
  { value: 'system', label: 'System' },
  { value: 'unknown', label: 'Unclear' },
];
const STATION_KINDS: Array<{ value: ProcessStationKind; label: string }> = [
  { value: 'normal', label: 'Step' },
  { value: 'gate', label: 'Gate' },
  { value: 'human', label: 'Human task' },
];

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function shortPath(path: string): string {
  const pieces = path.split(/[\\/]/);
  return pieces.at(-1) ?? path;
}

export function VideoImportDialog() {
  const isOpen = useStore((s) => s.videoImportDialogOpen);
  if (!isOpen) return null;
  return <VideoImportDialogContent />;
}

function VideoImportDialogContent() {
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

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-tool)] flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-5"
        onClick={close}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="video-import-title"
          data-testid="video-import-dialog"
          className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-3 sm:gap-3 sm:px-6 sm:py-4">
            <AuricIcon
              name="video_file"
              aria-hidden="true"
              className="text-lg text-primary-light"
            />
            <div>
              <h2 id="video-import-title" className="text-sm font-bold text-foreground">
                Import process from video
              </h2>
              <p className="mt-0.5 text-[10px] text-foreground-muted">
                Transcript, frames and links stay after import.
              </p>
            </div>
            <ol className="order-3 flex w-full items-center justify-between gap-1 font-mono text-[8px] uppercase tracking-[0.08em] sm:order-none sm:ml-auto sm:w-auto sm:justify-start sm:gap-2 sm:text-[9px] sm:tracking-[0.12em]">
              {['Video', 'Analyze', 'Review', 'Create'].map((label, index) => {
                const active =
                  (stage === 'select' && index === 0) ||
                  (stage === 'analyzing' && index === 1) ||
                  (stage === 'review' && index === 2) ||
                  (stage === 'saving' && index === 3);
                return (
                  <li
                    key={label}
                    className={active ? 'text-primary-light' : 'text-foreground-muted/50'}
                  >
                    {index + 1} {label}
                  </li>
                );
              })}
            </ol>
            <button
              onClick={close}
              disabled={stage === 'analyzing' || stage === 'saving'}
              aria-label="Close video import"
              className="ml-auto flex size-11 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary-light disabled:opacity-30 sm:ml-2"
            >
              <AuricIcon name="close" aria-hidden="true" className="text-lg" />
            </button>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5">
            {stage === 'select' && (
              <div className="mx-auto flex max-w-2xl flex-col gap-5">
                <div
                  ref={dropRef}
                  className={`flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed px-8 text-center transition-[border-color,background-color] duration-150 ${
                    dragging
                      ? 'border-primary/60 bg-primary/10'
                      : sourcePath
                        ? 'border-[#2effa5]/30 bg-[#2effa5]/[0.04]'
                        : 'border-white/15 bg-white/[0.015]'
                  }`}
                >
                  <AuricIcon
                    name={sourcePath ? 'movie' : 'upload_file'}
                    aria-hidden="true"
                    className="text-4xl text-foreground-muted/50"
                  />
                  <p className="mt-3 text-sm font-semibold text-foreground">
                    {sourcePath ? shortPath(sourcePath) : 'Drop a screen recording here'}
                  </p>
                  <p className="mt-1 max-w-md text-[11px] leading-relaxed text-foreground-muted">
                    {sourcePath
                      ? 'Ready to transcribe. Original stays untouched.'
                      : 'MP4, MOV, MKV, WEBM or M4V.'}
                  </p>
                  <button
                    onClick={() => void chooseVideo()}
                    className="mt-5 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold text-foreground transition-colors hover:bg-white/10"
                  >
                    {sourcePath ? 'Choose another video' : 'Choose video'}
                  </button>
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-black/20 px-4 py-3">
                  <AuricIcon
                    name="lock"
                    aria-hidden="true"
                    className="text-base text-primary-light"
                  />
                  <div>
                    <p className="text-[11px] font-semibold text-foreground">Source kept</p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-foreground-muted">
                      Your transcript and screenshots stay available for review.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {stage === 'analyzing' && (
              <div
                className="flex min-h-80 flex-col items-center justify-center text-center"
                aria-live="polite"
              >
                <AuricIcon
                  name="progress_activity"
                  aria-hidden="true"
                  className="animate-spin text-3xl text-primary-light"
                />
                <p className="mt-4 text-sm font-semibold text-foreground">
                  Analyzing the recording
                </p>
                <p className="mt-1 max-w-md text-[11px] leading-relaxed text-foreground-muted">
                  {progress}
                </p>
                <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-muted/50">
                  Long recordings can take several minutes
                </p>
                <button
                  type="button"
                  data-testid="video-import-cancel-analysis"
                  onClick={cancelAnalysis}
                  className="mt-5 rounded-lg border border-white/10 px-4 py-2 text-[11px] font-semibold text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  Cancel analysis
                </button>
              </div>
            )}

            {(stage === 'review' || stage === 'saving') && process && media && (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
                <section className="min-w-0">
                  <label className="block text-[9px] font-bold uppercase tracking-[0.14em] text-foreground-muted/60">
                    Mission
                    <input
                      value={process.title}
                      onChange={(event) => setProcess({ ...process, title: event.target.value })}
                      className="mt-1.5 w-full rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-sm font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary/50"
                    />
                  </label>
                  <label className="mt-3 block text-[9px] font-bold uppercase tracking-[0.14em] text-foreground-muted/60">
                    Success criteria
                    <textarea
                      value={process.successCriteria}
                      onChange={(event) =>
                        setProcess({ ...process, successCriteria: event.target.value })
                      }
                      rows={2}
                      className="mt-1.5 w-full resize-none rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-foreground outline-none focus:border-primary/50"
                    />
                  </label>

                  <div className="mt-5 flex items-center gap-2">
                    <h3 className="text-xs font-bold text-foreground">Process stations</h3>
                    <span className="font-mono text-[9px] text-foreground-muted">
                      {process.steps.length} extracted
                    </span>
                    <button
                      type="button"
                      onClick={addStep}
                      className="ml-auto rounded-lg border border-white/10 px-2.5 py-1 text-[10px] font-semibold text-foreground-muted hover:bg-white/5 hover:text-foreground"
                    >
                      Add step
                    </button>
                  </div>
                  <div className="mt-2 divide-y divide-white/5 border-y border-white/5">
                    {process.steps.map((step, index) => (
                      <div
                        key={stepKeys[index] ?? `step-${index}`}
                        className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 py-3 sm:grid-cols-[24px_minmax(0,1fr)_120px]"
                      >
                        <span className="pt-2 font-mono text-[10px] text-foreground-muted/50">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="min-w-0">
                          <input
                            ref={(element) => {
                              const key = stepKeys[index];
                              if (key && element) stepTitleRefs.current.set(key, element);
                            }}
                            aria-label={`Step ${index + 1} title`}
                            value={step.title}
                            onChange={(event) => updateStep(index, { title: event.target.value })}
                            className="w-full bg-transparent text-xs font-semibold text-foreground outline-none focus:text-primary-light"
                          />
                          <textarea
                            aria-label={`Step ${index + 1} notes`}
                            value={step.description}
                            onChange={(event) =>
                              updateStep(index, { description: event.target.value })
                            }
                            rows={2}
                            className="mt-1 w-full resize-none bg-transparent text-[10px] leading-relaxed text-foreground-muted outline-none focus:text-foreground"
                          />
                          <p className="mt-1 font-mono text-[9px] text-foreground-muted/50">
                            {step.sourceSegmentIds.length} transcript segment
                            {step.sourceSegmentIds.length === 1 ? '' : 's'}
                            {' · '}
                            {step.frameTimestampsMs.length} screenshot
                            {step.frameTimestampsMs.length === 1 ? '' : 's'}
                            {' · '}
                            {Math.round(step.confidence * 100)}% confidence
                          </p>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <select
                            aria-label={`Step ${index + 1} station kind`}
                            value={
                              step.stationKind ?? (step.actor === 'human' ? 'human' : 'normal')
                            }
                            onChange={(event) =>
                              updateStep(index, {
                                stationKind: event.target.value as ProcessStationKind,
                              })
                            }
                            className="h-8 rounded-lg border border-white/5 bg-black/30 px-2 text-[10px] text-foreground outline-none focus:border-primary/50"
                          >
                            {STATION_KINDS.map((kind) => (
                              <option key={kind.value} value={kind.value}>
                                {kind.label}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={`Step ${index + 1} actor`}
                            value={step.actor}
                            onChange={(event) =>
                              updateStep(index, { actor: event.target.value as ProcessActor })
                            }
                            className="h-7 rounded-lg border border-white/5 bg-black/30 px-2 text-[9px] text-foreground-muted outline-none focus:border-primary/50"
                          >
                            {ACTORS.map((actor) => (
                              <option key={actor.value} value={actor.value}>
                                {actor.label}
                              </option>
                            ))}
                          </select>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              aria-label={`Move step ${index + 1} up`}
                              disabled={index === 0}
                              onClick={() => moveStep(index, -1)}
                              className="min-h-11 min-w-11 rounded border border-white/10 px-2 py-1 text-[12px] text-foreground-muted focus-visible:outline-2 focus-visible:outline-primary-light disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label={`Move step ${index + 1} down`}
                              disabled={index === process.steps.length - 1}
                              onClick={() => moveStep(index, 1)}
                              className="min-h-11 min-w-11 rounded border border-white/10 px-2 py-1 text-[12px] text-foreground-muted focus-visible:outline-2 focus-visible:outline-primary-light disabled:opacity-30"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete step ${index + 1}`}
                              disabled={process.steps.length === 1}
                              onClick={() => deleteStep(index)}
                              className="ml-auto min-h-11 rounded border border-red-500/20 px-2 py-1 text-[10px] text-red-300 focus-visible:outline-2 focus-visible:outline-primary-light disabled:opacity-30"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <aside className="space-y-4 border-white/5 lg:border-l lg:pl-5">
                  <div>
                    <h3 className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-foreground-muted/60">
                      Video details
                    </h3>
                    <dl className="mt-2 space-y-2 text-[10px]">
                      <div>
                        <dt className="text-foreground-muted">Video</dt>
                        <dd className="mt-0.5 break-all text-foreground">{media.sourceName}</dd>
                      </div>
                      <div>
                        <dt className="text-foreground-muted">Transcript</dt>
                        <dd className="mt-0.5 text-foreground">
                          {media.transcript.length} timed segments
                        </dd>
                      </div>
                      <div>
                        <dt className="text-foreground-muted">Screenshots</dt>
                        <dd className="mt-0.5 text-foreground">
                          {media.frames.length} preserved frames
                        </dd>
                      </div>
                      <div>
                        <dt className="text-foreground-muted">Transcription</dt>
                        <dd className="mt-0.5 capitalize text-foreground">
                          {media.transcriptionProvider} Parakeet
                        </dd>
                      </div>
                    </dl>
                    <details className="mt-3 rounded-lg border border-white/5 bg-black/20 p-2">
                      <summary className="cursor-pointer text-[10px] font-semibold text-foreground">
                        Inspect transcript
                      </summary>
                      <ol className="mt-2 max-h-44 space-y-2 overflow-y-auto text-[9px] leading-relaxed text-foreground-muted">
                        {media.transcript.map((segment, index) => (
                          <li key={`${segment.startMs}-${index}`} className="flex gap-2">
                            <span className="font-mono text-primary-light">{index}</span>
                            <span>{segment.text}</span>
                          </li>
                        ))}
                      </ol>
                    </details>
                    <details className="mt-2 rounded-lg border border-white/5 bg-black/20 p-2">
                      <summary className="cursor-pointer text-[10px] font-semibold text-foreground">
                        Inspect screenshots
                      </summary>
                      <ul className="mt-2 max-h-44 space-y-2 overflow-y-auto text-[9px] text-foreground-muted">
                        {media.frames.map((frame) => (
                          <li key={frame.path}>
                            <button
                              type="button"
                              onClick={() =>
                                void import('@tauri-apps/plugin-opener').then(({ openPath }) =>
                                  openPath(frame.path)
                                )
                              }
                              aria-label={`Open screenshot at ${Math.round(frame.timestampMs / 1000)} second${Math.round(frame.timestampMs / 1000) === 1 ? '' : 's'}`}
                              className="flex min-h-11 w-full items-center gap-2 rounded-md border border-white/5 px-2 text-left hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-primary-light"
                            >
                              <span className="font-mono text-primary-light">
                                {Math.round(frame.timestampMs / 1000)}s
                              </span>
                              <span className="break-all">Open {shortPath(frame.path)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                  <div
                    className={`rounded-xl border px-3 py-2.5 ${unassignedCount > 0 ? 'border-[#ffce2e]/20 bg-[#ffce2e]/[0.04]' : 'border-[#2effa5]/20 bg-[#2effa5]/[0.04]'}`}
                  >
                    <p className="text-[10px] font-semibold text-foreground">
                      {unassignedCount > 0
                        ? `${unassignedCount} transcript segments need review`
                        : 'All transcript segments assigned'}
                    </p>
                    <p className="mt-1 text-[9px] leading-relaxed text-foreground-muted">
                      {unassignedCount > 0
                        ? 'They remain in the import record, which is linked from the mission.'
                        : 'The full transcript remains available for this import.'}
                    </p>
                  </div>
                  {process.ambiguities.length > 0 && (
                    <div>
                      <h3 className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#ffce2e]">
                        Ambiguous
                      </h3>
                      <ul className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-foreground-muted">
                        {process.ambiguities.map((item) => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {process.deferredIdeas.length > 0 && (
                    <div>
                      <h3 className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-foreground-muted/60">
                        Deferred
                      </h3>
                      <ul className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-foreground-muted">
                        {process.deferredIdeas.map((item) => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </aside>
              </div>
            )}

            {error && (
              <div className="mx-auto mt-4 max-w-2xl">
                <ToolFailureNotice failure={error} />
              </div>
            )}
          </main>

          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
          <footer className="flex flex-col gap-3 border-t border-white/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
            <p className="max-w-lg text-[9px] leading-relaxed text-foreground-muted/60">
              {media
                ? 'Your video, transcript, and screenshots are ready to review.'
                : 'Uses Parakeet for transcription and your configured model to identify the process.'}
            </p>
            <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto sm:flex-nowrap">
              {stage === 'review' && (
                <button
                  onClick={() => setStage('select')}
                  className="rounded-lg px-4 py-2 text-[11px] font-semibold text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  Back
                </button>
              )}
              {stage === 'select' && (
                <button
                  onClick={() => void analyze()}
                  disabled={!sourcePath}
                  className="rounded-lg bg-primary px-5 py-2 text-[11px] font-bold text-white transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Analyze video
                </button>
              )}
              {(stage === 'review' || stage === 'saving') && (
                <div className="flex flex-col items-end gap-2">
                  <label className="flex items-center gap-2 text-[10px] text-foreground-muted">
                    <input
                      type="checkbox"
                      checked={runAfterCreate}
                      onChange={(event) => setRunAfterCreate(event.target.checked)}
                      disabled={stage === 'saving'}
                    />
                    Start conductor after creation
                  </label>
                  <button
                    onClick={() => void commit()}
                    disabled={
                      stage === 'saving' ||
                      !process?.title.trim() ||
                      !process?.successCriteria.trim()
                    }
                    className="rounded-lg bg-primary px-5 py-2 text-[11px] font-bold text-white transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {stage === 'saving'
                      ? 'Creating mission...'
                      : runAfterCreate
                        ? 'Create and run'
                        : 'Create and review'}
                  </button>
                </div>
              )}
            </div>
          </footer>
        </div>
      </div>
      {confirmDialog}
    </>
  );
}
