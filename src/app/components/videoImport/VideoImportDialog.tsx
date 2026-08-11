'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { dbGet } from '@/lib/tauri/db';
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
import { buildVideoImportCommit } from '@/lib/videoImport/commitImport';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

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
  const addGoal = useStore((s) => s.addGoal);
  const addStation = useStore((s) => s.addStation);
  const saveGoals = useStore((s) => s.saveGoals);
  const setGoalLinesOpen = useStore((s) => s.setGoalLinesOpen);
  const showToast = useStore((s) => s.showToast);

  const [stage, setStage] = useState<DialogStage>('select');
  const [sourcePath, setSourcePath] = useState('');
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState('Preparing video...');
  const [media, setMedia] = useState<VideoMediaAnalysis | null>(null);
  const [process, setProcess] = useState<ExtractedProcess | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    if (stage === 'analyzing' || stage === 'saving') return;
    setOpen(false);
  }, [setOpen, stage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

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
              setError('Choose an MP4, MOV, MKV, WEBM or M4V video.');
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
    setStage('analyzing');
    setError(null);
    try {
      setProgress('Transcribing audio and preserving timed source material...');
      const analyzed = await analyzeVideoMedia(rootPath, sourcePath);
      setMedia(analyzed);

      setProgress('Grounding the process in transcript and screenshots...');
      const visionEnabled =
        (await dbGet(rootPath, 'video_import_settings', 'vision_enabled')) !== 'false';
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
      const extracted = parseExtractedProcess(response.content);
      await saveVideoProcessAnalysis(rootPath, analyzed.importId, {
        extracted,
        completeTranscript: analyzed.transcript,
        allFrames: analyzed.frames,
        sourcePath: analyzed.sourcePath,
        workspacePath: analyzed.workspacePath,
      });
      setProcess(extracted);
      setStage('review');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStage('select');
    }
  };

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

  const commit = async () => {
    if (!rootPath || !media || !process || stage === 'saving') return;
    setStage('saving');
    setError(null);
    try {
      const goalId = crypto.randomUUID();
      const built = buildVideoImportCommit({
        process,
        media,
        goalId,
        stationIds: process.steps.map(() => crypto.randomUUID()),
        now: timestamp(),
      });
      addGoal(built.goal);
      built.stations.forEach(addStation);
      await saveVideoProcessAnalysis(rootPath, media.importId, {
        reviewedProcess: process,
        goalId,
        stationIds: built.stations.map((station) => station.id),
        unassignedTranscript: built.unassignedTranscript,
        completeTranscript: media.transcript,
        allFrames: media.frames,
      });
      await saveGoals(rootPath);
      setOpen(false);
      setGoalLinesOpen(true);
      showToast(
        `Created “${built.goal.name}” with ${built.stations.length} sourced stations`,
        'success'
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
    <div
      className="fixed inset-0 z-[350] flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm"
      onClick={close}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-import-title"
        data-testid="video-import-dialog"
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a10] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
          <AuricIcon name="video_file" aria-hidden="true" className="text-lg text-primary-light" />
          <div>
            <h2 id="video-import-title" className="text-sm font-bold text-foreground">
              Import process from video
            </h2>
            <p className="mt-0.5 text-[10px] text-foreground-muted">
              Transcript, screenshots and source links remain inspectable after import.
            </p>
          </div>
          <ol className="ml-auto flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em]">
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
            className="ml-2 rounded-lg p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-30"
          >
            <AuricIcon name="close" aria-hidden="true" className="text-lg" />
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
                    ? 'Ready to transcribe. The original remains untouched.'
                    : 'MP4, MOV, MKV, WEBM or M4V. Audio, timed transcript and sampled frames are stored in the project import record.'}
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
                  <p className="text-[11px] font-semibold text-foreground">
                    No source information is discarded
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-foreground-muted">
                    Every transcript segment and screenshot stays in{' '}
                    <span className="font-mono">.auric/video-imports</span>. Unassigned material is
                    called out during review instead of silently omitted.
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
              <p className="mt-4 text-sm font-semibold text-foreground">Analyzing the recording</p>
              <p className="mt-1 max-w-md text-[11px] leading-relaxed text-foreground-muted">
                {progress}
              </p>
              <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-muted/50">
                Long recordings can take several minutes
              </p>
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

                <div className="mt-5 flex items-baseline gap-2">
                  <h3 className="text-xs font-bold text-foreground">Process stations</h3>
                  <span className="font-mono text-[9px] text-foreground-muted">
                    {process.steps.length} extracted
                  </span>
                </div>
                <div className="mt-2 divide-y divide-white/5 border-y border-white/5">
                  {process.steps.map((step, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[24px_minmax(0,1fr)_110px] gap-3 py-3"
                    >
                      <span className="pt-2 font-mono text-[10px] text-foreground-muted/50">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0">
                        <input
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
                          value={step.stationKind ?? (step.actor === 'human' ? 'human' : 'normal')}
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
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <aside className="space-y-4 border-white/5 lg:border-l lg:pl-5">
                <div>
                  <h3 className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-foreground-muted/60">
                    Source record
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
                </div>
                <div
                  className={`rounded-xl border px-3 py-2.5 ${unassignedCount > 0 ? 'border-[#ffce2e]/20 bg-[#ffce2e]/[0.04]' : 'border-[#2effa5]/20 bg-[#2effa5]/[0.04]'}`}
                >
                  <p className="text-[10px] font-semibold text-foreground">
                    {unassignedCount > 0
                      ? `${unassignedCount} unassigned transcript segments`
                      : 'All transcript segments assigned'}
                  </p>
                  <p className="mt-1 text-[9px] leading-relaxed text-foreground-muted">
                    {unassignedCount > 0
                      ? 'They remain in the lossless import record and are linked from the mission.'
                      : 'The full transcript remains available independently of the station links.'}
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
            <p
              role="alert"
              className="mx-auto mt-4 max-w-2xl rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-red-300"
            >
              {error}
            </p>
          )}
        </main>

        <footer className="flex items-center justify-between border-t border-white/5 px-6 py-4">
          <p className="max-w-lg text-[9px] leading-relaxed text-foreground-muted/60">
            {media
              ? `Import record: ${media.workspacePath}`
              : 'Uses Parakeet for transcription and the LLM configured in Settings for process analysis.'}
          </p>
          <div className="flex gap-2">
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
              <button
                onClick={() => void commit()}
                disabled={
                  stage === 'saving' || !process?.title.trim() || !process?.successCriteria.trim()
                }
                className="rounded-lg bg-primary px-5 py-2 text-[11px] font-bold text-white transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
              >
                {stage === 'saving' ? 'Creating mission...' : 'Create mission'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
