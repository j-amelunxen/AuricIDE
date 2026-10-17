'use client';

import { useEffect, useId, useState } from 'react';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { SettingsToggle } from '@/app/components/ui/settings/SettingsToggle';
import { useStore } from '@/lib/store';
import { normalizeProjectPath } from '@/lib/config/supervisorPolicy';
import {
  supervisorLinkJobsUsage,
  supervisorLinkPolicyGet,
  supervisorLinkPolicySet,
  type JobLimits,
  type JobsUsage,
  type LinkProjectConfig,
  type SupervisorLinkPolicy,
} from '@/lib/tauri/supervisorLink';
import { NUMBER_CLASS } from './SupervisorProjectRow';

const EMPTY_CONFIG: LinkProjectConfig = { documentTypes: [], jobKinds: [] };

const CONFIG_EXAMPLE = JSON.stringify(
  {
    documentTypes: [
      { name: 'diagram', globs: ['docs/**/*.diagram.json'], nameField: 'meta.title' },
    ],
    jobKinds: [{ kind: 'diagram.draw', instructions: 'docs/agents/draw.md' }],
  },
  null,
  2
);

/** The policy's entry for a starred path, which Rust stores canonically. */
function entryFor(policy: SupervisorLinkPolicy, path: string): [string, LinkProjectConfig] | null {
  const wanted = normalizeProjectPath(path);
  const found = Object.entries(policy.projects).find(
    ([listed]) => normalizeProjectPath(listed) === wanted
  );
  return found ?? null;
}

function withoutProject(policy: SupervisorLinkPolicy, path: string): SupervisorLinkPolicy {
  const wanted = normalizeProjectPath(path);
  const projects = Object.fromEntries(
    Object.entries(policy.projects).filter(([listed]) => normalizeProjectPath(listed) !== wanted)
  );
  return { ...policy, projects };
}

function formatConfig(config: LinkProjectConfig): string {
  const empty = config.documentTypes.length === 0 && config.jobKinds.length === 0;
  return empty ? '' : JSON.stringify(config, null, 2);
}

/** The configuration in `text`, or why it is none. Rust checks the rest on save. */
function parseConfig(text: string): { config: LinkProjectConfig } | { error: string } {
  if (text.trim() === '') return { config: EMPTY_CONFIG };
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { error: 'The configuration is a JSON object with documentTypes and jobKinds.' };
    }
    const raw = value as Partial<LinkProjectConfig>;
    return {
      config: { ...raw, documentTypes: raw.documentTypes ?? [], jobKinds: raw.jobKinds ?? [] },
    };
  } catch (reason) {
    return { error: `Not JSON: ${reason instanceof Error ? reason.message : String(reason)}` };
  }
}

interface ProjectRowProps {
  name: string;
  path: string;
  entry: [string, LinkProjectConfig] | null;
  usedToday: number;
  onSave: (config: LinkProjectConfig | null) => Promise<string | null>;
}

/**
 * One starred project: shared or not, and what it offers when shared. The
 * parent keys it by what is stored, so a save Rust kept starts it afresh.
 */
function ProjectRow({ name, path, entry, usedToday, onSave }: ProjectRowProps) {
  const id = useId();
  const stored = entry ? formatConfig(entry[1]) : '';
  const [text, setText] = useState(stored);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const parsed = parseConfig(text);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(await onSave(parsed.config));
  };

  return (
    <div className="space-y-2">
      <SettingsToggle
        label={name}
        description={path}
        checked={entry !== null}
        onChange={(on) =>
          void onSave(on ? EMPTY_CONFIG : null).then((refused) => setError(refused))
        }
        testId={`supervisor-link-project-${name}`}
      />
      {entry && (
        <div className="space-y-1 pl-4">
          <label
            htmlFor={id}
            className="block text-[10px] font-semibold tracking-wide text-foreground-muted"
          >
            Document types and job kinds (JSON)
          </label>
          <textarea
            id={id}
            data-testid={`supervisor-link-config-${name}`}
            aria-describedby={`${id}-hint`}
            aria-invalid={error !== null}
            value={text}
            rows={6}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            placeholder={CONFIG_EXAMPLE}
            className="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-foreground-muted/50 focus:border-primary focus:outline-none"
          />
          <p id={`${id}-hint`} className="text-[10px] text-foreground-muted">
            Globs and paths are relative to the project. A client may only start the job kinds
            listed here; the agent follows the kind&apos;s instructions file and may only write the
            kind&apos;s <code>writes</code> (default: the document globs). A type&apos;s{' '}
            <code>assets</code> globs name files clients may read but never write. Jobs here in the
            last 24 hours: <span className="tabular-nums">{usedToday}</span>.
          </p>
          {error && (
            <p role="alert" className="text-[11px] text-red-400">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={text === stored}
            title={text === stored ? 'Nothing changed' : undefined}
            data-testid={`supervisor-link-save-${name}`}
            className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-foreground hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

/** Keyed by `value` in the parent, so a stored change resets the draft. */
function LimitInput({
  label,
  value,
  testId,
  onCommit,
}: {
  label: string;
  value: number | null;
  testId: string;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const commit = () => {
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : Math.max(0, Math.floor(Number(trimmed)));
    if (next !== value && (next === null || Number.isFinite(next))) onCommit(next);
  };
  return (
    <label className="flex items-center gap-2 text-xs text-foreground">
      {label}
      <input
        type="number"
        min={0}
        step={1}
        data-testid={testId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={NUMBER_CLASS}
      />
    </label>
  );
}

/** The runaway counter on jobs: both limits and what the last 24 hours used. */
function JobCounter({
  limits,
  usage,
  onSave,
}: {
  limits: JobLimits;
  usage: JobsUsage | null;
  onSave: (limits: JobLimits) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 p-3">
      <p className="text-xs font-semibold text-foreground">Job counter</p>
      <p className="text-[10px] text-foreground-muted">
        A guard against a client starting jobs in a loop, not a budget: jobs started in any 24
        hours. 0 switches jobs off. Empty per-project limit: none.
      </p>
      <div className="flex flex-wrap gap-4">
        <LimitInput
          key={`daily-${limits.dailyLimit}`}
          label="Jobs per 24 h"
          value={limits.dailyLimit}
          testId="supervisor-link-daily-limit"
          onCommit={(value) => onSave({ ...limits, dailyLimit: value ?? 0 })}
        />
        <LimitInput
          key={`project-${limits.perProjectDailyLimit}`}
          label="Per project"
          value={limits.perProjectDailyLimit}
          testId="supervisor-link-project-limit"
          onCommit={(value) => onSave({ ...limits, perProjectDailyLimit: value })}
        />
      </div>
      {usage && (
        <p className="text-[11px] text-foreground" data-testid="supervisor-link-usage">
          <span className="tabular-nums">
            {usage.inWindow} of {limits.dailyLimit}
          </span>{' '}
          used in the last 24 hours
          {usage.running > 0 && <span className="tabular-nums">, {usage.running} running</span>}.
        </p>
      )}
    </div>
  );
}

/**
 * The supervisor link (`docs/design-supervisor-link.md`): a client of the
 * Supervisor Control API talks to supervisors over a local socket, reads and
 * proposes JSON documents and starts jobs in the projects shared here. What a
 * document or a job is, each project says for itself; every change arrives
 * as a branch for review.
 */
export function SupervisorLinkSettings() {
  const starredProjects = useStore((s) => s.starredProjects);
  const showToast = useStore((s) => s.showToast);
  const [policy, setPolicy] = useState<SupervisorLinkPolicy | null>(null);
  const [usage, setUsage] = useState<JobsUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supervisorLinkPolicyGet()
      .then((loaded) => !cancelled && setPolicy(loaded))
      .catch((reason: unknown) => !cancelled && setError(String(reason)));
    supervisorLinkJobsUsage()
      .then((loaded) => !cancelled && setUsage(loaded))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** Stores `next`; answers Rust's refusal, or null when it was stored. */
  const store = async (next: SupervisorLinkPolicy): Promise<string | null> => {
    try {
      setPolicy(await supervisorLinkPolicySet(next));
      return null;
    } catch (reason) {
      return String(reason);
    }
  };

  const saveProject = (path: string) => async (config: LinkProjectConfig | null) => {
    if (!policy) return null;
    const rest = withoutProject(policy, path);
    const existing = entryFor(policy, path);
    const key = existing?.[0] ?? path;
    return await store(config ? { ...rest, projects: { ...rest.projects, [key]: config } } : rest);
  };

  const saveLimits = (limits: JobLimits) => {
    if (!policy) return;
    void store({ ...policy, jobs: limits }).then(
      (refused) => refused && showToast(`Could not save the job limit: ${refused}`, 'error')
    );
  };

  const used = (path: string) => {
    const wanted = normalizeProjectPath(path);
    return Object.entries(usage?.byProject ?? {})
      .filter(([listed]) => normalizeProjectPath(listed) === wanted)
      .reduce((sum, [, count]) => sum + count, 0);
  };

  return (
    <SettingsSection title="Supervisor link" icon="hub">
      <p className="text-xs leading-relaxed text-foreground-muted">
        A client of the Supervisor Control API can start and talk to supervisors and their agents
        over a local socket. It sees nothing you started in the IDE. In the projects you share below
        it may read the JSON documents you describe and start the job kinds you list. Every change
        it proposes and every job result arrives as a branch you merge or delete.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          Could not read the supervisor link settings: {error}
        </p>
      ) : !policy ? (
        <p className="text-xs text-foreground-muted">Loading…</p>
      ) : (
        <>
          <JobCounter limits={policy.jobs} usage={usage} onSave={saveLimits} />
          {starredProjects.length === 0 ? (
            <p className="text-xs text-foreground-muted">
              Star a project in Quick Access to share it with the link.
            </p>
          ) : (
            <div className="space-y-3">
              {starredProjects.map((project) => (
                <ProjectRow
                  key={`${project.path}:${JSON.stringify(entryFor(policy, project.path))}`}
                  name={project.name}
                  path={project.path}
                  entry={entryFor(policy, project.path)}
                  usedToday={used(project.path)}
                  onSave={saveProject(project.path)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </SettingsSection>
  );
}
