'use client';

export interface HeadingBreadcrumb {
  title: string;
  lineNumber: number;
}

export interface HeaderProps {
  breadcrumbs: string[];
  headingBreadcrumbs?: HeadingBreadcrumb[];
  onHeadingBreadcrumbClick?: (lineNumber: number) => void;
  isConnected?: boolean;
  connectionLabel?: string;
  llmConfigured?: boolean;
  variant?: 'editor' | 'canvas';
  onCommandPalette?: () => void;
}

export function Header({
  breadcrumbs,
  headingBreadcrumbs,
  onHeadingBreadcrumbClick,
  isConnected = false,
  connectionLabel,
  llmConfigured = false,
  variant = 'editor',
  onCommandPalette,
}: HeaderProps) {
  const hasHeadingCrumbs = headingBreadcrumbs && headingBreadcrumbs.length > 0;
  const baseHeight = variant === 'canvas' ? 'h-14' : hasHeadingCrumbs ? 'h-[4.5rem]' : 'h-12';

  return (
    <header
      data-testid="header"
      className={`glass flex items-center justify-between px-4 z-10 transition-all duration-300 ${baseHeight}`}
    >
      {/* Left: Brand & Breadcrumbs */}
      <div className="flex flex-col justify-center gap-0.5">
        <div className="flex items-center gap-6">
          <div
            data-testid="header-logo"
            className="flex items-center gap-2 select-none group cursor-default"
          >
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-white/5 group-hover:border-primary/30 transition-colors overflow-hidden">
              <img
                src="/logo.svg"
                alt="Auric Logo"
                className="h-6 w-6 drop-shadow-[0_0_5px_rgba(188,19,254,0.5)]"
              />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-display font-black text-sm tracking-tight text-white">
                AURIC
                <span className="text-primary-light font-light tracking-[0.1em] ml-0.5">IDE</span>
              </span>
              <span className="text-[9px] text-foreground-muted uppercase tracking-widest opacity-60">
                AI Native
              </span>
            </div>
          </div>

          <div className="h-6 w-[1px] bg-white/10" />

          {breadcrumbs.length > 0 && (
            <nav className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
              {breadcrumbs.map((crumb, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 animate-in fade-in slide-in-from-left-2 duration-300"
                >
                  {i > 0 && (
                    <span className="opacity-30 material-symbols-outlined text-[10px]">
                      chevron_right
                    </span>
                  )}
                  <span
                    className={`${i === breadcrumbs.length - 1 ? 'text-primary-light drop-shadow-[0_0_8px_rgba(214,106,255,0.3)]' : 'hover:text-foreground transition-colors'}`}
                  >
                    {crumb}
                  </span>
                </span>
              ))}
            </nav>
          )}
        </div>

        {hasHeadingCrumbs && (
          <nav
            data-testid="heading-breadcrumbs"
            className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted pl-[3.75rem]"
          >
            <span className="material-symbols-outlined text-[10px] opacity-50">description</span>
            {headingBreadcrumbs.map((crumb, i) => (
              <span
                key={i}
                className="flex items-center gap-1.5 animate-in fade-in slide-in-from-left-2 duration-300"
              >
                {i > 0 && (
                  <span className="opacity-30 material-symbols-outlined text-[10px]">
                    chevron_right
                  </span>
                )}
                <button
                  onClick={() => onHeadingBreadcrumbClick?.(crumb.lineNumber)}
                  className={`hover:text-foreground transition-colors cursor-pointer ${i === headingBreadcrumbs.length - 1 ? 'text-primary-light drop-shadow-[0_0_8px_rgba(214,106,255,0.3)]' : ''}`}
                >
                  {crumb.title}
                </button>
              </span>
            ))}
          </nav>
        )}
      </div>

      {/* Right: Controls & Status */}
      <div className="flex items-center gap-4">
        <button
          data-testid="command-palette-trigger"
          onClick={onCommandPalette}
          className="group flex items-center gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-1.5 text-xs text-foreground-muted transition-all hover:border-primary/30 hover:bg-white/10 hover:text-foreground hover:shadow-[0_0_15px_rgba(188,19,254,0.15)]"
        >
          <span className="material-symbols-outlined text-sm opacity-70 group-hover:opacity-100">
            search
          </span>
          <span className="font-medium">Find Agent...</span>
          <kbd className="ml-2 rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-[9px] text-foreground-muted group-hover:text-foreground">
            ⌘K
          </kbd>
        </button>

        <div
          data-testid="connection-badge"
          className={`flex items-center gap-2 rounded-full border border-white/5 bg-black/20 px-3 py-1 text-[10px] font-medium backdrop-blur-sm ${
            isConnected ? 'text-green-400' : 'text-red-400'
          }`}
        >
          <span className="relative flex h-2 w-2">
            {isConnected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
            ></span>
          </span>
          {isConnected ? connectionLabel || 'Connected' : 'Disconnected'}
        </div>

        <div
          data-testid="llm-status-badge"
          className={`flex items-center gap-2 rounded-full border border-white/5 bg-black/20 px-3 py-1 text-[10px] font-medium backdrop-blur-sm ${
            llmConfigured ? 'text-primary-light' : 'text-orange-400'
          }`}
        >
          <span className="material-symbols-outlined text-[12px]">
            {llmConfigured ? 'psychology' : 'warning'}
          </span>
          {llmConfigured ? 'Direct LLM Active' : 'Direct LLM Missing'}
        </div>
      </div>
    </header>
  );
}
