'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import {
  layoutFleetTreemap,
  TREEMAP_FALLBACK_SIZE,
  type TreemapGroupCell,
} from '@/lib/agents/treemap';
import { ProjectSection, type ProjectSectionProps } from './ProjectSection';

export interface FleetTreemapGroup {
  repoPath: string;
  agents: AgentInfo[];
}

export interface FleetTreemapProps extends Omit<ProjectSectionProps, 'repoPath' | 'agents'> {
  groups: FleetTreemapGroup[];
}

/**
 * The Agent Console's command view: a Finviz-style treemap of project
 * clusters. Size follows agent count so a busy repo claims more of the
 * screen than a singleton, and the map fills the pane instead of scrolling.
 */
export function FleetTreemap({ groups, ...sectionProps }: FleetTreemapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(TREEMAP_FALLBACK_SIZE);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    };
    apply(el.clientWidth, el.clientHeight);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      apply(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout: TreemapGroupCell[] = layoutFleetTreemap(
    groups.map((group) => ({ id: group.repoPath, agents: group.agents })),
    size.w,
    size.h
  );
  const agentsByRepo = new Map(groups.map((group) => [group.repoPath, group.agents]));

  return (
    <div
      ref={ref}
      data-testid="fleet-treemap"
      className="relative h-full min-h-0 w-full overflow-hidden"
    >
      {layout.map((cell) => (
        <ProjectSection
          key={cell.id}
          repoPath={cell.id}
          agents={agentsByRepo.get(cell.id) ?? []}
          layout={cell}
          {...sectionProps}
        />
      ))}
    </div>
  );
}
