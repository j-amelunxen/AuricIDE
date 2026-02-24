'use client';

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
  return (
    <footer
      data-testid="status-bar"
      className="glass border-t-0 flex h-8 items-center justify-between px-4 text-[10px] font-medium text-foreground-muted select-none"
    >
      <div className="flex items-center gap-4">
        {branch && (
          <button className="flex items-center gap-1.5 hover:text-primary transition-colors">
            <span className="material-symbols-outlined text-[12px]">source</span>
            <span>{branch}</span>
          </button>
        )}
        {syncStatus && (
          <button className="flex items-center gap-1.5 hover:text-foreground transition-colors">
            <span className="material-symbols-outlined text-[12px] animate-spin">sync</span>
          </button>
        )}
        {(errorCount > 0 || warningCount > 0) && (
          <button
            data-testid="problems-indicator"
            onClick={onProblemsClick}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            {errorCount > 0 && <span className="text-red-400">● {errorCount}</span>}
            {warningCount > 0 && <span className="text-amber-400">⚠ {warningCount}</span>}
          </button>
        )}
      </div>

      <div className="flex items-center gap-6">
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
      </div>
    </footer>
  );
}
