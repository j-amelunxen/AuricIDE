'use client';

import { normalizeProjectPath } from '@/lib/config/supervisorPolicy';
import type { EffectiveLinkPolicy, LinkOrigin } from '@/lib/tauri/supervisorLink';

const ORIGIN_LABEL: Record<LinkOrigin, string> = {
  global: 'Global',
  project: 'Project',
  override: 'Override',
};

const ORIGIN_TITLE: Record<LinkOrigin, string> = {
  global: 'Inherited from the global defaults',
  project: "Defined only in this project's entry",
  override: "This project's entry replaces the global default of the same name",
};

/** The value stored under `path`, matched the way Rust canonicalises it. */
function byPath<T>(record: Record<string, T>, path: string): T | undefined {
  const wanted = normalizeProjectPath(path);
  return Object.entries(record).find(([listed]) => normalizeProjectPath(listed) === wanted)?.[1];
}

function jobs(count: number): string {
  return `${count} ${count === 1 ? 'job' : 'jobs'} per 24 h`;
}

/** The per-project job limit that applies here, and who set it. */
function limitText(effective: EffectiveLinkPolicy, path: string): string {
  const own = byPath(effective.projectDailyLimits, path);
  if (own !== undefined) return `${jobs(own)}, set by the project`;
  const shared = effective.jobs.perProjectDailyLimit;
  if (shared !== null) return `${jobs(shared)}, from the global per-project limit`;
  return `No per-project limit; the global ${jobs(effective.jobs.dailyLimit)} apply`;
}

function OriginList({
  label,
  names,
  origins,
}: {
  label: string;
  names: string[];
  origins: Record<string, LinkOrigin>;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-wide text-foreground-muted">{label}</p>
      {names.length === 0 ? (
        <p className="text-[11px] text-foreground-muted">None</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {names.map((name) => {
            const origin = origins[name] ?? 'project';
            return (
              <li
                key={name}
                className="flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[11px]"
              >
                <code className="text-foreground">{name}</code>
                <span
                  title={ORIGIN_TITLE[origin]}
                  className="rounded bg-white/5 px-1 text-[9px] font-semibold tracking-wide text-foreground-muted uppercase"
                >
                  {ORIGIN_LABEL[origin]}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * What the link actually offers for one shared project: the global defaults
 * merged with the project's entry, as Rust resolved it. Read-only on purpose;
 * the entry above is where it is changed.
 */
export function EffectiveProject({
  name,
  path,
  effective,
  failure,
}: {
  name: string;
  path: string;
  effective: EffectiveLinkPolicy | null;
  failure: string | null;
}) {
  const testId = `supervisor-link-effective-${name}`;
  if (failure) {
    return (
      <p data-testid={testId} className="text-[11px] text-foreground-muted">
        Could not read the effective configuration: {failure}
      </p>
    );
  }
  if (!effective) return null;

  const project = byPath(effective.projects, path);
  if (!project) {
    return (
      <p data-testid={testId} className="text-[11px] text-amber-400">
        Its merged configuration is invalid, so the link does not see this project. Check the entry
        above against the global defaults.
      </p>
    );
  }
  const origins = byPath(effective.origins, path) ?? { documentTypes: {}, jobKinds: {} };

  return (
    <div data-testid={testId} className="space-y-1.5 rounded-lg border border-white/10 p-2">
      <p className="text-[10px] font-semibold tracking-wide text-foreground-muted">Effective</p>
      <OriginList
        label="Document types"
        names={project.documentTypes.map((type) => type.name)}
        origins={origins.documentTypes}
      />
      <OriginList
        label="Job kinds"
        names={project.jobKinds.map((kind) => kind.kind)}
        origins={origins.jobKinds}
      />
      <p className="text-[11px] text-foreground" data-testid="supervisor-link-effective-limit">
        {limitText(effective, path)}
      </p>
    </div>
  );
}
