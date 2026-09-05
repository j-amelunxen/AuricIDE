import type { VideoMediaAnalysis } from '@/lib/tauri/videoImport';
import type { ExtractedProcess } from '@/lib/videoImport/processExtraction';
import { shortPath } from './types';

interface ReviewVideoDetailsAsideProps {
  media: VideoMediaAnalysis;
  process: ExtractedProcess;
  unassignedCount: number;
}

export function ReviewVideoDetailsAside({
  media,
  process,
  unassignedCount,
}: ReviewVideoDetailsAsideProps) {
  return (
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
            <dd className="mt-0.5 text-foreground">{media.transcript.length} timed segments</dd>
          </div>
          <div>
            <dt className="text-foreground-muted">Screenshots</dt>
            <dd className="mt-0.5 text-foreground">{media.frames.length} preserved frames</dd>
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
  );
}
