'use client';

import { useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { QUICK_ACCESS_HINT, QuickAccess } from './QuickAccess';
import { RecentProjects } from './RecentProjects';

type SwitcherTab = 'quick' | 'recent';

const TABS: { id: SwitcherTab; label: string }[] = [
  { id: 'quick', label: 'Quick Access' },
  { id: 'recent', label: 'Recent' },
];

export interface ProjectSwitcherProps {
  /** The currently open project, so Quick Access can mark its own tile. */
  currentPath: string | null;
  /** Open another project by path — the same flow for both tabs. */
  onOpenProject?: (path: string) => void;
}

/**
 * The one place on the cockpit for "take me to another project". Quick Access
 * (the projects you chose to keep) and Recent (the ones you happened to open)
 * answer the same question, so they share a surface and take turns on it
 * instead of stacking two lists of project names on top of each other.
 *
 * Quick Access leads because it is the curated half: if a project is worth
 * starring, it is the one you are most likely reaching for. Recent stays one
 * click away for everything else — and it is where starring happens, so the
 * two tabs feed each other.
 */
export function ProjectSwitcher({ currentPath, onOpenProject }: ProjectSwitcherProps) {
  const [tab, setTab] = useState<SwitcherTab>('quick');
  const starredCount = useStore((s) => s.starredProjects.length);
  const recentCount = useStore((s) => s.recentProjects.length);
  const tabRefs = useRef<Partial<Record<SwitcherTab, HTMLButtonElement | null>>>({});

  const counts: Record<SwitcherTab, number> = { quick: starredCount, recent: recentCount };

  const step = (delta: number) => {
    const index = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(index + delta + TABS.length) % TABS.length];
    setTab(next.id);
    // Roving tabindex: the tab that just took the selection has to take the
    // focus with it, or the next arrow key lands on the one left behind.
    tabRefs.current[next.id]?.focus();
  };

  return (
    <div
      data-testid="project-switcher"
      // One card, the same width and material as the conductor panel above it.
      // Tabs without a panel under them read as a lid on nothing, and a bare
      // tile row next to bordered blocks is what makes a centred column look
      // untidy: every element gets its own edge. This gives it exactly one.
      //
      // `glass-card` rather than a hand-rolled border+background, because that
      // is the app's material: it already answers prefers-reduced-transparency
      // and prefers-contrast in globals.css. A private copy would not.
      className="glass-card w-full min-w-0 max-w-3xl rounded-2xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/5 px-3 py-2">
        <div role="tablist" aria-label="Projects" className="flex items-center gap-1">
          {TABS.map((t) => {
            const selected = t.id === tab;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`project-switcher-tab-${t.id}`}
                data-testid={`project-switcher-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`project-switcher-panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    step(1);
                  } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    step(-1);
                  }
                }}
                // active: — feedback lands on pointer-down, not on the click
                // that follows it. A tab that only reacts once the panel has
                // swapped reads as lag.
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-[color,background-color,transform] duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light ${
                  selected
                    ? 'bg-primary/15 text-primary-light'
                    : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
                }`}
              >
                {t.label}
                {counts[t.id] > 0 && (
                  <span
                    data-testid={`project-switcher-count-${t.id}`}
                    className="text-[9px] font-medium tabular-nums tracking-normal text-foreground-muted/60"
                  >
                    {counts[t.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* The header is the one line that says what the active tab can do. */}
        {tab === 'quick' && starredCount > 0 && (
          <span data-testid="quick-access-hint" className="text-[9px] text-foreground-muted/50">
            {QUICK_ACCESS_HINT}
          </span>
        )}
      </div>
      <div
        // Keyed so the incoming panel actually plays its entrance. It enters
        // from the side its tab sits on, so the motion points at where the
        // content came from instead of appearing out of nowhere; globals.css
        // neutralises it under prefers-reduced-motion.
        key={tab}
        role="tabpanel"
        id={`project-switcher-panel-${tab}`}
        aria-labelledby={`project-switcher-tab-${tab}`}
        // Deeper padding at the top than the sides: the skill wheel opens
        // radially around a tile and reaches above it, and it must not have to
        // climb over the tab bar to do so.
        className={`flex w-full justify-center px-4 pb-5 pt-7 animate-in fade-in duration-200 ${
          tab === 'recent' ? 'slide-in-from-right-2' : 'slide-in-from-left-2'
        }`}
      >
        {tab === 'quick' ? (
          <QuickAccess currentPath={currentPath} onSwitchProject={onOpenProject} />
        ) : (
          <RecentProjects onOpenProject={onOpenProject} />
        )}
      </div>
    </div>
  );
}
