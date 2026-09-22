import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { describeGitMode, isExecutableBitFlip, type GitModeChange } from '@/lib/git/modeChange';

interface ModeOnlyChangeProps {
  fileName: string;
  change: GitModeChange;
}

/** A patch that changes a file's mode and nothing else has no lines to show. */
export function ModeOnlyChange({ fileName, change }: ModeOnlyChangeProps) {
  return (
    <div data-testid="diff-mode-only" className="flex h-full flex-col bg-editor-bg">
      <div className="flex items-center gap-2 border-b border-border-dark px-4 py-2">
        <AuricIcon name="difference" className="text-sm text-primary-light" />
        <span className="text-xs font-medium text-foreground">{fileName}</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-foreground">Only the file mode changed</p>
        <p className="font-mono text-xs text-foreground-muted">
          {change.oldMode} → {change.newMode}
        </p>
        <p className="text-xs text-foreground-muted">
          {describeGitMode(change.oldMode)} → {describeGitMode(change.newMode)}
        </p>
        {isExecutableBitFlip(change) && (
          <p
            data-testid="diff-mode-only-hint"
            className="mt-2 max-w-md text-[11px] leading-relaxed text-foreground-muted"
          >
            Filesystems that don&apos;t keep the executable bit — mounted shares, network drives —
            cause this for every file. <code className="font-mono">core.fileMode</code> in this
            checkout decides whether git looks at it.
          </p>
        )}
      </div>
    </div>
  );
}
