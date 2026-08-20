'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentInfo } from '@/lib/tauri/agents';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { isFinishedAgent } from '@/lib/agents/fleet';
import { agentState, AGENT_STATE_LABEL, type AgentState } from '@/lib/agents/state';
import {
  placeTabPreview,
  TAB_PREVIEW_DELAY_MS,
  TAB_PREVIEW_GRACE_MS,
  TAB_PREVIEW_WIDTH_PX,
  type TabPreviewPlacement,
} from '@/lib/agents/tabPreview';

const TAB_STATE_STYLES: Record<AgentState, { dot: string; label: string }> = {
  working: { dot: 'bg-primary animate-pulse', label: 'text-primary' },
  waiting: { dot: 'bg-amber-400', label: 'text-amber-400' },
  'needs-input': { dot: 'bg-amber-300', label: 'text-amber-300' },
  stalled: { dot: 'bg-orange-300', label: 'text-orange-300' },
  done: { dot: 'bg-emerald-400', label: 'text-emerald-400' },
  error: { dot: 'bg-red-400', label: 'text-red-400' },
  queued: { dot: 'bg-foreground-muted', label: 'text-foreground-muted' },
};

/**
 * Opens the prompt card once the pointer has rested on a tab, and keeps it up
 * while the pointer is on its way into the card — a strip of tabs is scanned
 * by sweeping across it, so anything that appears on contact would flicker.
 */
function usePromptPreview() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<TabPreviewPlacement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const place = useCallback(() => {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPlacement(placeTabPreview(rect, { width: window.innerWidth, height: window.innerHeight }));
  }, []);

  const open = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(place, TAB_PREVIEW_DELAY_MS);
  }, [clearTimer, place]);

  const close = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => setPlacement(null), TAB_PREVIEW_GRACE_MS);
  }, [clearTimer]);

  const closeNow = useCallback(() => {
    clearTimer();
    setPlacement(null);
  }, [clearTimer]);

  /** The pointer reached the card — whatever was scheduled is off. */
  const hold = clearTimer;

  useEffect(() => clearTimer, [clearTimer]);

  const isOpen = placement !== null;
  useEffect(() => {
    if (!isOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape belongs to the card while it is up; the terminal behind it
      // listens on the same key and must not take this one.
      event.stopPropagation();
      closeNow();
    };
    // The card is pinned to a point on screen and knows nothing about the
    // strip scrolling under it, so re-measure rather than leave it behind.
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [isOpen, place, closeNow]);

  return { shellRef, placement, open, close, closeNow, hold };
}

interface PromptPreviewProps {
  agent: AgentInfo;
  state: AgentState;
  placement: TabPreviewPlacement;
  onHold: () => void;
  onRelease: () => void;
}

/**
 * The whole start instruction, laid out to be read. Drawn into `document.body`
 * because the tab strip scrolls sideways and would otherwise clip it.
 */
function PromptPreview({ agent, state, placement, onHold, onRelease }: PromptPreviewProps) {
  const style = TAB_STATE_STYLES[state];
  const prompt = agent.currentTask?.trim();

  return createPortal(
    <div
      role="tooltip"
      id={`agent-tab-preview-${agent.id}`}
      data-testid={`agent-tab-preview-${agent.id}`}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
      style={{
        left: placement.left,
        top: placement.top ?? undefined,
        bottom: placement.bottom ?? undefined,
        width: TAB_PREVIEW_WIDTH_PX,
        maxHeight: placement.maxHeight,
        zIndex: 'var(--z-toast)',
      }}
      className={`fixed flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[rgba(10,10,16,0.97)] shadow-2xl backdrop-blur-md animate-in fade-in duration-150 ${
        placement.top !== null ? 'slide-in-from-top-1' : 'slide-in-from-bottom-1'
      }`}
    >
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/5 px-3 py-2">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-foreground">
          {agent.name}
        </span>
        <span className={`text-[8px] font-black uppercase tracking-widest ${style.label}`}>
          {AGENT_STATE_LABEL[state]}
        </span>
      </div>
      {prompt ? (
        <p
          data-testid={`agent-tab-preview-prompt-${agent.id}`}
          className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2.5 text-[11px] leading-relaxed text-foreground-muted"
        >
          {prompt}
        </p>
      ) : (
        <p className="px-3 py-2.5 text-[11px] italic text-foreground-muted/60">
          No start prompt was recorded for this agent.
        </p>
      )}
    </div>,
    document.body
  );
}

export interface AgentTabProps {
  agent: AgentInfo;
  isActive: boolean;
  /** Shared clock, so a strip of tabs ages in one step rather than per tab. */
  now: number;
  onSelect: () => void;
  /** Absent when neither killing nor dismissing is wired up. */
  onEnd?: () => void;
}

export function AgentTab({ agent, isActive, now, onSelect, onEnd }: AgentTabProps) {
  const { shellRef, placement, open, close, closeNow, hold } = usePromptPreview();

  const state = agentState(agent, now);
  const style = TAB_STATE_STYLES[state];
  const endLabel = isFinishedAgent(agent) ? `Dismiss ${agent.name}` : `Stop ${agent.name}`;

  return (
    <div
      ref={shellRef}
      data-testid={`agent-tab-shell-${agent.id}`}
      onMouseEnter={open}
      onMouseLeave={close}
      className={`group flex min-w-40 flex-1 items-center overflow-hidden rounded-lg border whitespace-nowrap transition-colors ${
        isActive
          ? 'border-primary/40 bg-primary/15 text-white'
          : 'border-white/5 bg-white/[0.02] text-foreground-muted hover:bg-white/5 hover:text-foreground'
      }`}
    >
      <button
        role="tab"
        aria-selected={isActive}
        aria-describedby={placement ? `agent-tab-preview-${agent.id}` : undefined}
        data-testid={`agent-tab-${agent.id}`}
        data-state={state}
        onClick={() => {
          // The terminal underneath changes; a card left hanging over it now
          // describes the tab the user just left.
          closeNow();
          onSelect();
        }}
        onFocus={open}
        onBlur={closeNow}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            closeNow();
            onEnd?.();
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider"
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${style.dot}`}
        />
        <span className="min-w-0 flex-1 truncate">{agent.name}</span>
        <span className={`flex-shrink-0 text-[8px] font-black tracking-widest ${style.label}`}>
          {AGENT_STATE_LABEL[state]}
        </span>
      </button>
      {onEnd && (
        <button
          type="button"
          data-testid={`agent-tab-close-${agent.id}`}
          aria-label={endLabel}
          title={endLabel}
          onClick={() => {
            closeNow();
            onEnd();
          }}
          className={`mr-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-foreground-muted transition-[opacity,transform,color,background-color] hover:bg-red-500/15 hover:text-red-400 active:scale-[0.96] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/60 ${
            isActive
              ? 'opacity-70'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          <AuricIcon name="close" aria-hidden="true" className="text-[11px]" />
        </button>
      )}
      {placement && (
        <PromptPreview
          agent={agent}
          state={state}
          placement={placement}
          onHold={hold}
          onRelease={close}
        />
      )}
    </div>
  );
}
