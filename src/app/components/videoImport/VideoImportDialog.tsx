'use client';

import { useStore } from '@/lib/store';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ToolFailureNotice } from './ToolFailureNotice';
import { useVideoImportDialog } from './dialog/useVideoImportDialog';
import { VideoSelectStage } from './dialog/VideoSelectStage';
import { VideoAnalyzingStage } from './dialog/VideoAnalyzingStage';
import { ReviewProcessSteps } from './dialog/ReviewProcessSteps';
import { ReviewVideoDetailsAside } from './dialog/ReviewVideoDetailsAside';

export function VideoImportDialog() {
  const isOpen = useStore((s) => s.videoImportDialogOpen);
  if (!isOpen) return null;
  return <VideoImportDialogContent />;
}

function VideoImportDialogContent() {
  const {
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
  } = useVideoImportDialog();

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
              <VideoSelectStage
                dropRef={dropRef}
                dragging={dragging}
                sourcePath={sourcePath}
                onChooseVideo={() => void chooseVideo()}
              />
            )}

            {stage === 'analyzing' && (
              <VideoAnalyzingStage progress={progress} onCancel={cancelAnalysis} />
            )}

            {(stage === 'review' || stage === 'saving') && process && media && (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
                <ReviewProcessSteps
                  process={process}
                  stepKeys={stepKeys}
                  stepTitleRefs={stepTitleRefs}
                  onUpdateProcessTitle={(title) => setProcess({ ...process, title })}
                  onUpdateSuccessCriteria={(successCriteria) =>
                    setProcess({ ...process, successCriteria })
                  }
                  onUpdateStep={updateStep}
                  onMoveStep={moveStep}
                  onDeleteStep={deleteStep}
                  onAddStep={addStep}
                />
                <ReviewVideoDetailsAside
                  media={media}
                  process={process}
                  unassignedCount={unassignedCount}
                />
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
