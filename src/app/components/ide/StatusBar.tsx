'use client';

import { useAttribution } from '@/lib/settings/attribution';
import { TruthsLight } from '../requirements/TruthsLight';
import { CliQuotaChip } from '../usage/CliQuotaChip';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export interface StatusBarProps {
  branch?: string;
  syncStatus?: string;
  encoding?: string;
  language?: string;
  cursorPos?: { line: number; col: number };
  errorCount?: number;
  warningCount?: number;
  onProblemsClick?: () => void;
}

export function StatusBar({
  branch,
  syncStatus,
  encoding = 'UTF-8',
  language = 'Markdown',
  cursorPos,
  errorCount = 0,
  warningCount = 0,
  onProblemsClick,
}: StatusBarProps) {
  const [showAttribution] = useAttribution();

  return (
    <footer
      data-testid="status-bar"
      className="glass border-t-0 flex h-8 items-center justify-between px-4 text-[10px] font-medium text-foreground-muted select-none"
    >
      <div className="flex items-center gap-4">
        {branch && (
          <button className="flex items-center gap-1.5 hover:text-primary transition-colors">
            <AuricIcon name="source" aria-hidden="true" className="text-[12px]" />
            <span>{branch}</span>
          </button>
        )}
        {syncStatus && (
          <button
            aria-label="Sync status"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <AuricIcon name="sync" aria-hidden="true" className="text-[12px] animate-spin" />
          </button>
        )}
        {(errorCount > 0 || warningCount > 0) && (
          <button
            data-testid="problems-indicator"
            aria-label="Problems"
            onClick={onProblemsClick}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            {errorCount > 0 && <span className="text-red-400">● {errorCount}</span>}
            {warningCount > 0 && <span className="text-amber-400">⚠ {warningCount}</span>}
          </button>
        )}
      </div>

      <div className="flex items-center gap-6">
        <TruthsLight />
        <CliQuotaChip />
        {cursorPos && (
          <span className="font-mono text-primary/80">
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
        )}
        <div className="h-3 w-[1px] bg-white/10" />
        <span className="hover:text-foreground transition-colors cursor-pointer">{encoding}</span>
        <span className="hover:text-foreground transition-colors cursor-pointer">{language}</span>
        {language === 'Markdown' && (
          <span
            data-testid="slash-hint"
            className="opacity-40 text-[9px]"
            title="Type / for commands"
          >
            <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono text-[9px]">/</kbd> commands
          </span>
        )}
        {showAttribution && (
          <>
            <div className="h-3 w-[1px] bg-white/10" />
            <span data-testid="made-with-credit" className="opacity-50 text-[9px] tracking-wide">
              Made with{' '}
              <span aria-hidden="true" className="text-primary">
                ♥
              </span>{' '}
              by software-architecture.ai
            </span>
          </>
        )}
      </div>
    </footer>
  );
}
