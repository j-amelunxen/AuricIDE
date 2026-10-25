'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import type { ProviderPolicy } from '@/lib/config/providerPolicy';
import { normalizeProjectPath, type SupervisorPolicy } from '@/lib/config/supervisorPolicy';
import {
  setProjectAllowed,
  updateSupervisorProject,
  type UnattendedBlocker,
} from '@/lib/config/supervisorPolicyEdit';
import { rankProjects } from '@/lib/search/projectSearch';
import type { ProviderInfo } from '@/lib/tauri/providers';
import type { StarredProject } from '@/lib/tauri/starredProjects';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SETTINGS_HINT_CLASS } from '@/app/components/ui/settings/SettingsGroup';
import { SupervisorProjectRow } from './SupervisorProjectRow';

/** The project descriptions' drafts, owned by the page's save flow. */
interface DescriptionDrafts {
  value: (path: string) => string;
  isDirty: (path: string) => boolean;
  edit: (path: string, text: string) => void;
}

type Segment = 'all' | 'on' | 'off';

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
];

interface SupervisorProjectsPageProps {
  projects: StarredProject[];
  draft: SupervisorPolicy;
  saved: SupervisorPolicy;
  providers: ProviderInfo[];
  projectPolicies: Record<string, ProviderPolicy>;
  blockers: UnattendedBlocker[];
  descriptions: DescriptionDrafts;
  onChange: (draft: SupervisorPolicy) => void;
}

const isOn = (draft: SupervisorPolicy, path: string) =>
  draft.projects[normalizeProjectPath(path)]?.allowed === true;

/**
 * Settings → Supervisor → Projects: every starred project as one compact row, a filter that
 * narrows by name as you type, and On/Off segments. The segments filter on what was on when
 * one was picked, so a row switched off in "On" stays put until the filter changes rather than
 * vanishing under the pointer. Rows that are edited or need a permission mode say so, and a
 * filter that hides one of the latter offers to show it.
 */
// code-gate: complexity-function-length, complexity-parameter-count - one props object; one list view: filter state, its header and the rows; each part is a few lines
export function SupervisorProjectsPage({
  projects,
  draft,
  saved,
  providers,
  projectPolicies,
  blockers,
  descriptions,
  onChange,
}: SupervisorProjectsPageProps) {
  const blockedCount = (path: string) =>
    blockers.filter((b) => b.path === normalizeProjectPath(path)).length;
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [segmentPaths, setSegmentPaths] = useState<ReadonlySet<string> | null>(null);
  // A project that needs a decision before Save works starts open.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(projects.filter((p) => blockedCount(p.path) > 0).map((p) => p.path))
  );
  const searchId = useId();

  const setOpen = (path: string, open: boolean) =>
    setExpanded((was) => {
      const next = new Set(was);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });

  const pickSegment = (next: Segment) => {
    setSegment(next);
    setSegmentPaths(
      next === 'all'
        ? null
        : new Set(
            projects.filter((p) => isOn(draft, p.path) === (next === 'on')).map((p) => p.path)
          )
    );
  };

  const matches = rankProjects(projects, query).filter(
    (match) => !segmentPaths || segmentPaths.has(match.item.path)
  );
  const visible = new Set(matches.map((m) => m.item.path));
  const hiddenBlocked = projects.filter((p) => blockedCount(p.path) > 0 && !visible.has(p.path));
  const filtered = matches.length !== projects.length;
  const onCount = projects.filter((p) => isOn(draft, p.path)).length;
  const segmentCount = { all: projects.length, on: onCount, off: projects.length - onCount };

  const showBlocked = () => {
    setQuery('');
    pickSegment('all');
    setExpanded((was) => new Set([...was, ...hiddenBlocked.map((p) => p.path)]));
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Esc clears the filter first; only an empty field lets it close Settings.
    if (e.key !== 'Escape' || query === '') return;
    e.preventDefault();
    e.stopPropagation();
    setQuery('');
  };

  if (projects.length === 0) {
    return (
      <p className={SETTINGS_HINT_CLASS}>
        Star a project in Quick Access to offer it to the supervisor.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-[-1.5rem] z-10 -mx-6 space-y-2 border-b border-white/5 bg-surface px-6 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <label htmlFor={searchId} className="sr-only">
              Filter projects
            </label>
            <AuricIcon
              name="search"
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-foreground-muted"
            />
            <input
              id={searchId}
              type="search"
              data-testid="supervisor-projects-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Filter projects by name or path"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-8 text-xs text-foreground placeholder:text-foreground-muted/70 focus:border-primary focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search field"
                data-testid="supervisor-projects-clear"
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center rounded p-0.5 text-foreground-muted hover:text-foreground"
              >
                <AuricIcon name="close" aria-hidden="true" className="text-sm" />
              </button>
            )}
          </div>
          <div
            role="group"
            aria-label="Show projects"
            className="flex rounded-lg border border-white/10 bg-white/5 p-0.5"
          >
            {SEGMENTS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={segment === id}
                data-testid={`supervisor-projects-segment-${id}`}
                onClick={() => pickSegment(id)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  segment === id
                    ? 'bg-white/10 font-medium text-foreground'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                {label} <span className="tabular-nums opacity-70">{segmentCount[id]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p
            aria-live="polite"
            data-testid="supervisor-projects-count"
            className="text-[11px] tabular-nums text-foreground-muted"
          >
            {filtered
              ? `${matches.length} of ${projects.length} projects`
              : `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}
          </p>
          {hiddenBlocked.length > 0 && (
            <button
              type="button"
              data-testid="supervisor-projects-show-blocked"
              onClick={showBlocked}
              className="text-[11px] text-red-300 underline-offset-2 hover:underline"
            >
              {hiddenBlocked.length === 1
                ? '1 hidden project needs a permission mode. Show it'
                : `${hiddenBlocked.length} hidden projects need a permission mode. Show them`}
            </button>
          )}
        </div>
      </div>

      {matches.length === 0 ? (
        <EmptyResult
          query={query}
          segment={segment}
          onClear={() => {
            setQuery('');
            pickSegment('all');
          }}
        />
      ) : (
        <ul className="space-y-1.5" aria-label="Starred projects">
          {matches.map(({ item: project, nameIndices }) => {
            const key = normalizeProjectPath(project.path);
            const entry = draft.projects[key];
            return (
              <SupervisorProjectRow
                key={project.path}
                project={project}
                entry={entry}
                providers={providers}
                projectPolicy={projectPolicies[project.path]}
                description={descriptions.value(project.path)}
                expanded={expanded.has(project.path)}
                edited={
                  JSON.stringify(entry) !== JSON.stringify(saved.projects[key]) ||
                  descriptions.isDirty(project.path)
                }
                attention={blockedCount(project.path)}
                matchIndices={nameIndices}
                onExpandedChange={(open) => setOpen(project.path, open)}
                onDescriptionChange={(text) => descriptions.edit(project.path, text)}
                onAllowedChange={(allowed) => {
                  onChange(setProjectAllowed(draft, project.path, allowed));
                  // Switching on is the moment to tune it; switching off leaves nothing to tune.
                  setOpen(project.path, allowed);
                }}
                onChange={(next) =>
                  onChange(updateSupervisorProject(draft, project.path, () => next))
                }
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyResult({
  query,
  segment,
  onClear,
}: {
  query: string;
  segment: Segment;
  onClear: () => void;
}) {
  const text = query
    ? `No project matches “${query}”`
    : segment === 'on'
      ? 'No project is switched on.'
      : 'Every project is switched on.';
  return (
    <div
      data-testid="supervisor-projects-empty"
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center"
    >
      <p className="text-xs text-foreground-muted">{text}</p>
      <button
        type="button"
        onClick={onClear}
        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-foreground-muted transition-colors hover:text-foreground"
      >
        {query ? 'Clear filter' : 'Show all projects'}
      </button>
    </div>
  );
}
