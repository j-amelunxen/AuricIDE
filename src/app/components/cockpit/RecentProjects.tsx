'use client';

import { useStore } from '@/lib/store';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export interface RecentProjectsProps {
  /** Open a recent project by path (same flow as Quick Access tiles). */
  onOpenProject?: (path: string) => void;
}

/**
 * Recents on Mission Control / welcome. Star pins into Quick Access; the
 * list stays on this same surface so starring is not a hunt through another
 * room.
 */
export function RecentProjects({ onOpenProject }: RecentProjectsProps) {
  const recentProjects = useStore((s) => s.recentProjects);
  const starredProjects = useStore((s) => s.starredProjects);
  const toggleStarredProject = useStore((s) => s.toggleStarredProject);
  const removeRecentProject = useStore((s) => s.removeRecentProject);

  if (recentProjects.length === 0) return null;

  return (
    <div className="w-80 text-left" data-testid="recent-projects">
      <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
        Recent Projects
      </h2>
      <ul className="space-y-1">
        {recentProjects.map((project) => {
          const isStarred = starredProjects.some((s) => s.path === project.path);
          return (
            <li key={project.path} className="group flex items-center">
              <button
                onClick={() => onOpenProject?.(project.path)}
                className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/5"
              >
                <AuricIcon name="folder" className="text-base text-primary-light" />
                <span className="truncate text-sm font-medium text-foreground">{project.name}</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleStarredProject(project.path);
                }}
                title={isStarred ? 'Unstar: remove from Quick Access' : 'Star for Quick Access'}
                data-testid={`star-recent-${project.path}`}
                className={`mr-0.5 rounded p-1 transition-all ${
                  isStarred
                    ? 'text-primary-light opacity-100'
                    : 'text-foreground-muted opacity-0 hover:bg-white/10 hover:text-foreground group-hover:opacity-100'
                }`}
              >
                <AuricIcon name="star" className="text-[14px]" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeRecentProject(project.path);
                }}
                title="Remove from recent projects"
                data-testid={`remove-recent-${project.path}`}
                className="mr-1 rounded p-1 text-foreground-muted opacity-0 transition-all hover:bg-white/10 hover:text-foreground group-hover:opacity-100"
              >
                <AuricIcon name="close" className="text-[14px]" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
