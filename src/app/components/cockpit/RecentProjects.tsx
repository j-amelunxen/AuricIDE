'use client';

import { useStore } from '@/lib/store';
import { ProjectTileFace } from './ProjectTileFace';
import { PROJECT_TILE_COLUMNS, PROJECT_TILE_GRID } from './projectGrid';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export interface RecentProjectsProps {
  /** Open a recent project by path (same flow as Quick Access tiles). */
  onOpenProject?: (path: string) => void;
}

/**
 * The recents tab of the project switcher. Same tiles as Quick Access, on the
 * same grid — the two tabs answer one question, so they must not look like two
 * different kinds of thing. Ordered by when the project was last opened, which
 * is the only thing recency is good for.
 *
 * Starring pins a project into Quick Access from right here: that is the whole
 * path from "I keep coming back to this" to "it has a permanent spot", and it
 * should not be a hunt through another room.
 */
export function RecentProjects({ onOpenProject }: RecentProjectsProps) {
  const recentProjects = useStore((s) => s.recentProjects);
  const starredProjects = useStore((s) => s.starredProjects);
  const toggleStarredProject = useStore((s) => s.toggleStarredProject);
  const removeRecentProject = useStore((s) => s.removeRecentProject);

  return (
    <div
      data-testid="recent-projects"
      className="flex w-full max-w-3xl flex-col items-center gap-3"
    >
      {recentProjects.length === 0 ? (
        <p data-testid="recent-projects-empty" className="text-[11px] text-foreground-muted/70">
          Nothing opened yet.
        </p>
      ) : (
        <div
          data-testid="recent-projects-row"
          data-columns={PROJECT_TILE_COLUMNS}
          className={PROJECT_TILE_GRID}
        >
          {recentProjects.map((project) => {
            const isStarred = starredProjects.some((s) => s.path === project.path);
            return (
              <div
                key={project.path}
                data-testid={`recent-projects-item-${project.path}`}
                className="group/tile relative flex w-20 flex-col items-center gap-1.5"
              >
                {/* Same anatomy as a Quick Access tile: the icon owns its own
                    positioning context, so both badges hang off the icon
                    rather than off the column around it. */}
                <div className="relative h-10 w-10">
                  <button
                    type="button"
                    data-testid={`recent-tile-${project.path}`}
                    onClick={() => onOpenProject?.(project.path)}
                    title={project.name}
                    // A glyph or generated-initials tile carries no text of its
                    // own, so the name has to be stated rather than left to the
                    // title attribute.
                    aria-label={`Open ${project.name}`}
                    className="flex h-10 w-10 items-center justify-center rounded-xl shadow-sm ring-1 ring-white/10 transition-[transform,box-shadow] duration-150 group-hover/tile:shadow-[0_0_16px_rgba(var(--primary-rgb),0.18)] group-hover/tile:ring-white/25 active:scale-[0.94]"
                  >
                    <ProjectTileFace path={project.path} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStarredProject(project.path);
                    }}
                    title={isStarred ? 'Unstar: remove from Quick Access' : 'Star for Quick Access'}
                    aria-label={
                      isStarred
                        ? `Remove ${project.name} from Quick Access`
                        : `Star ${project.name} for Quick Access`
                    }
                    data-testid={`star-recent-${project.path}`}
                    className={`absolute -bottom-1.5 -left-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-background transition-[opacity,color] duration-150 focus-visible:opacity-100 ${
                      isStarred
                        ? 'text-primary-light opacity-100'
                        : 'text-foreground-muted opacity-0 hover:text-foreground group-hover/tile:opacity-100'
                    }`}
                  >
                    <AuricIcon name="star" aria-hidden="true" className="text-[11px]" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRecentProject(project.path);
                    }}
                    title={`Remove ${project.name} from recent projects`}
                    aria-label={`Remove ${project.name} from recent projects`}
                    data-testid={`remove-recent-${project.path}`}
                    className="absolute -bottom-1.5 -right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-red-300/20 bg-background text-red-300/80 opacity-0 transition-[opacity,color] duration-150 hover:text-red-300 focus-visible:opacity-100 group-hover/tile:opacity-100"
                  >
                    <AuricIcon name="close" aria-hidden="true" className="text-[11px]" />
                  </button>
                </div>
                <span
                  title={project.name}
                  className="max-w-full truncate text-[10px] font-medium text-foreground-muted"
                >
                  {project.name}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
