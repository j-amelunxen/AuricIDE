'use client';

import Image from 'next/image';
import { ConductorPulse } from '../goals/ConductorPulse';
import { AttentionChip } from '../agents/AttentionChip';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export interface HeadingBreadcrumb {
  title: string;
  lineNumber: number;
}

export interface HeaderProps {
  breadcrumbs: string[];
  headingBreadcrumbs?: HeadingBreadcrumb[];
  onHeadingBreadcrumbClick?: (lineNumber: number) => void;
  isConnected?: boolean;
  llmConfigured?: boolean;
  variant?: 'editor' | 'canvas';
  onCommandPalette?: () => void;
  onOpenSettings?: (category?: string) => void;
  /** Reveals the agents panel, for the attention chip to point at. */
  onShowAgents?: () => void;
}

export function Header({
  breadcrumbs,
  headingBreadcrumbs,
  onHeadingBreadcrumbClick,
  isConnected = false,
  llmConfigured = false,
  variant = 'editor',
  onCommandPalette,
  onOpenSettings,
  onShowAgents,
}: HeaderProps) {
  const hasHeadingCrumbs = headingBreadcrumbs && headingBreadcrumbs.length > 0;
  const baseHeight = variant === 'canvas' ? 'h-14' : hasHeadingCrumbs ? 'h-[4.5rem]' : 'h-12';

  return (
    <header
      data-testid="header"
      className={`glass flex flex-col z-10 transition-[height] duration-300 ${baseHeight}`}
    >
      {/*
        On macOS this row *is* the window's title bar: the native one is a
        transparent overlay (`titleBarStyle: "Overlay"`), so the strip that used
        to be an empty grey band carries the app's own chrome instead. Two
        things it owes the window in return — a fixed height, because the
        traffic lights sit at a fixed offset and cannot follow a header that
        grows, and a drag region, because a transparent title bar hands window
        dragging to the page. `--titlebar-gutter` is the room the buttons need
        on the left, and it is zero anywhere they are not drawn.
      */}
      <div
        data-testid="titlebar-row"
        data-tauri-drag-region
        className="flex h-12 shrink-0 select-none items-center justify-between pr-4 pl-[calc(1rem+var(--titlebar-gutter,0px))]"
      >
        {/* Left: Brand & Breadcrumbs */}
        <div data-tauri-drag-region className="flex items-center gap-6">
          <div
            data-testid="header-logo"
            data-tauri-drag-region
            className="flex items-center gap-2 group cursor-default"
          >
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-white/5 group-hover:border-primary/30 transition-colors overflow-hidden">
              <Image
                src="/logo.svg"
                alt="Auric Logo"
                width={24}
                height={24}
                className="drop-shadow-[0_0_5px_rgba(var(--primary-rgb),0.5)]"
              />
            </div>
            <span className="font-display font-black text-sm tracking-tight text-white">
              AURIC
              <span className="text-primary-light font-light tracking-[0.1em] ml-0.5">IDE</span>
            </span>
          </div>

          <div data-tauri-drag-region className="h-6 w-[1px] bg-white/10" />

          {breadcrumbs.length > 0 && (
            <nav
              data-tauri-drag-region
              className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted"
            >
              {breadcrumbs.map((crumb, i) => (
                <span
                  key={i}
                  data-tauri-drag-region
                  className="flex items-center gap-1.5 animate-in fade-in slide-in-from-left-2 duration-300"
                >
                  {i > 0 && (
                    <AuricIcon
                      name="chevron_right"
                      aria-hidden="true"
                      className="opacity-30 text-[10px]"
                    />
                  )}
                  <span
                    data-tauri-drag-region
                    className={`${i === breadcrumbs.length - 1 ? 'text-primary-light drop-shadow-[0_0_8px_rgba(var(--primary-light-rgb),0.3)]' : 'hover:text-foreground transition-colors'}`}
                  >
                    {crumb}
                  </span>
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
            className="group flex items-center gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-1.5 text-xs text-foreground-muted transition-[background-color,border-color,color,box-shadow] duration-150 hover:border-primary/30 hover:bg-white/10 hover:text-foreground hover:shadow-[0_0_15px_rgba(var(--primary-rgb),0.15)] active:scale-[0.98]"
          >
            <AuricIcon
              name="search"
              aria-hidden="true"
              className="text-sm opacity-70 group-hover:opacity-100"
            />
            <span className="font-medium">Command Palette</span>
            <kbd className="ml-2 rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-[9px] text-foreground-muted group-hover:text-foreground">
              ⌘K
            </kbd>
          </button>

          <ConductorPulse />

          {/* The count the hidden window title used to carry. */}
          <AttentionChip onShowAgents={onShowAgents} />

          {/* Status chips only speak up when something needs attention. */}
          {!isConnected && (
            <div
              data-testid="connection-badge"
              title="Start the agent CLI to connect"
              className="flex items-center gap-2 rounded-full border border-white/5 bg-black/20 px-3 py-1 text-[10px] font-medium text-red-400 backdrop-blur-sm"
            >
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
              </span>
              Disconnected
            </div>
          )}

          {!llmConfigured && (
            <button
              type="button"
              data-testid="llm-status-badge"
              title="Configure an LLM provider in Settings"
              onClick={() => onOpenSettings?.('llm')}
              className="flex items-center gap-2 rounded-full border border-white/5 bg-black/20 px-3 py-1 text-[10px] font-medium text-orange-400 backdrop-blur-sm"
            >
              <AuricIcon name="warning" aria-hidden="true" className="text-[12px]" />
              LLM not configured
            </button>
          )}
        </div>
      </div>

      {hasHeadingCrumbs && (
        <nav
          data-testid="heading-breadcrumbs"
          className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted pl-[calc(4.75rem+var(--titlebar-gutter,0px))]"
        >
          <AuricIcon name="description" aria-hidden="true" className="text-[10px] opacity-50" />
          {headingBreadcrumbs.map((crumb, i) => (
            <span
              key={i}
              className="flex items-center gap-1.5 animate-in fade-in slide-in-from-left-2 duration-300"
            >
              {i > 0 && (
                <AuricIcon
                  name="chevron_right"
                  aria-hidden="true"
                  className="opacity-30 text-[10px]"
                />
              )}
              <button
                onClick={() => onHeadingBreadcrumbClick?.(crumb.lineNumber)}
                className={`hover:text-foreground transition-colors cursor-pointer ${i === headingBreadcrumbs.length - 1 ? 'text-primary-light drop-shadow-[0_0_8px_rgba(var(--primary-light-rgb),0.3)]' : ''}`}
              >
                {crumb.title}
              </button>
            </span>
          ))}
        </nav>
      )}
    </header>
  );
}
