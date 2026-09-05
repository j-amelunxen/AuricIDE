import type { MutableRefObject } from 'react';
import type {
  ExtractedProcess,
  ProcessActor,
  ProcessStationKind,
} from '@/lib/videoImport/processExtraction';
import { ACTORS, STATION_KINDS } from './types';

interface ReviewProcessStepsProps {
  process: ExtractedProcess;
  stepKeys: string[];
  stepTitleRefs: MutableRefObject<Map<string, HTMLInputElement>>;
  onUpdateProcessTitle: (title: string) => void;
  onUpdateSuccessCriteria: (criteria: string) => void;
  onUpdateStep: (index: number, changes: Partial<ExtractedProcess['steps'][number]>) => void;
  onMoveStep: (index: number, offset: -1 | 1) => void;
  onDeleteStep: (index: number) => void;
  onAddStep: () => void;
}

export function ReviewProcessSteps({
  process,
  stepKeys,
  stepTitleRefs,
  onUpdateProcessTitle,
  onUpdateSuccessCriteria,
  onUpdateStep,
  onMoveStep,
  onDeleteStep,
  onAddStep,
}: ReviewProcessStepsProps) {
  return (
    <section className="min-w-0">
      <label className="block text-[9px] font-bold uppercase tracking-[0.14em] text-foreground-muted/60">
        Mission
        <input
          value={process.title}
          onChange={(event) => onUpdateProcessTitle(event.target.value)}
          className="mt-1.5 w-full rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-sm font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary/50"
        />
      </label>
      <label className="mt-3 block text-[9px] font-bold uppercase tracking-[0.14em] text-foreground-muted/60">
        Success criteria
        <textarea
          value={process.successCriteria}
          onChange={(event) => onUpdateSuccessCriteria(event.target.value)}
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
          onClick={onAddStep}
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
                onChange={(event) => onUpdateStep(index, { title: event.target.value })}
                className="w-full bg-transparent text-xs font-semibold text-foreground outline-none focus:text-primary-light"
              />
              <textarea
                aria-label={`Step ${index + 1} notes`}
                value={step.description}
                onChange={(event) => onUpdateStep(index, { description: event.target.value })}
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
                  onUpdateStep(index, {
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
                  onUpdateStep(index, { actor: event.target.value as ProcessActor })
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
                  onClick={() => onMoveStep(index, -1)}
                  className="min-h-11 min-w-11 rounded border border-white/10 px-2 py-1 text-[12px] text-foreground-muted focus-visible:outline-2 focus-visible:outline-primary-light disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move step ${index + 1} down`}
                  disabled={index === process.steps.length - 1}
                  onClick={() => onMoveStep(index, 1)}
                  className="min-h-11 min-w-11 rounded border border-white/10 px-2 py-1 text-[12px] text-foreground-muted focus-visible:outline-2 focus-visible:outline-primary-light disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Delete step ${index + 1}`}
                  disabled={process.steps.length === 1}
                  onClick={() => onDeleteStep(index)}
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
  );
}
