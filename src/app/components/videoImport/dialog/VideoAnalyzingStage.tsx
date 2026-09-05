import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface VideoAnalyzingStageProps {
  progress: string;
  onCancel: () => void;
}

export function VideoAnalyzingStage({ progress, onCancel }: VideoAnalyzingStageProps) {
  return (
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
      <p className="mt-1 max-w-md text-[11px] leading-relaxed text-foreground-muted">{progress}</p>
      <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-muted/50">
        Long recordings can take several minutes
      </p>
      <button
        type="button"
        data-testid="video-import-cancel-analysis"
        onClick={onCancel}
        className="mt-5 rounded-lg border border-white/10 px-4 py-2 text-[11px] font-semibold text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
      >
        Cancel analysis
      </button>
    </div>
  );
}
