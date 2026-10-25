'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import {
  LearnMore,
  SETTINGS_HINT_CLASS,
  SettingsGroup,
} from '@/app/components/ui/settings/SettingsGroup';
import { SettingsToggle } from '@/app/components/ui/settings/SettingsToggle';
import { useStore } from '@/lib/store';
import { normalizeProjectPath } from '@/lib/config/supervisorPolicy';
import {
  supervisorLinkJobsUsage,
  supervisorLinkPolicyEffective,
  supervisorLinkPolicyGet,
  supervisorLinkPolicySet,
  supervisorLinkProposalDecide,
  supervisorLinkProposals,
  type EffectiveLinkPolicy,
  type JobLimits,
  type JobsUsage,
  type LinkDefaults,
  type LinkProjectEntry,
  type PolicyProposals,
  type ProposalDecision,
  type StoredLinkPolicy,
} from '@/lib/tauri/supervisorLink';
import { NUMBER_CLASS } from './SupervisorProjectRow';
import { EffectiveProject } from './SupervisorLinkEffective';
import { ProposalsBlock } from './SupervisorLinkProposals';

/** Shared, inheriting every global default. */
const EMPTY_ENTRY: LinkProjectEntry = { documentTypes: [], jobKinds: [] };

const DEFAULTS_EXAMPLE = JSON.stringify(
  {
    documentTypes: [{ name: 'scene', globs: ['docs/**/*.scene.json'], nameField: 'hud.title' }],
    jobKinds: [{ kind: 'scene.draw', globalInstructions: 'scene.draw.md' }],
  },
  null,
  2
);

const ENTRY_EXAMPLE = JSON.stringify(
  {
    disabledJobKinds: ['scene.draw'],
    documentTypes: [{ name: 'diagram', globs: ['docs/**/*.diagram.json'] }],
    jobKinds: [{ kind: 'diagram.draw', instructions: 'docs/agents/draw.md' }],
    dailyLimit: 5,
  },
  null,
  2
);

const TEXTAREA_CLASS =
  'w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-foreground-muted/50 focus:border-primary focus:outline-none';

const SAVE_CLASS =
  'rounded-md border border-white/10 px-2.5 py-1 text-xs text-foreground hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50';

function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** The policy's entry for a starred path, which Rust stores canonically. */
function entryFor(policy: StoredLinkPolicy, path: string): [string, LinkProjectEntry] | null {
  const wanted = normalizeProjectPath(path);
  const found = Object.entries(policy.projects).find(
    ([listed]) => normalizeProjectPath(listed) === wanted
  );
  return found ?? null;
}

function withoutProject(policy: StoredLinkPolicy, path: string): StoredLinkPolicy {
  const wanted = normalizeProjectPath(path);
  const projects = Object.fromEntries(
    Object.entries(policy.projects).filter(([listed]) => normalizeProjectPath(listed) !== wanted)
  );
  return { ...policy, projects };
}

/** Empty text for an object that only holds empty lists, JSON otherwise. */
function formatJson(value: { documentTypes: unknown[]; jobKinds: unknown[] }): string {
  const { documentTypes, jobKinds, ...rest } = value;
  const empty =
    documentTypes.length === 0 && jobKinds.length === 0 && Object.keys(rest).length === 0;
  return empty ? '' : JSON.stringify(value, null, 2);
}

/**
 * The object in `text` with both lists present, or why it is none. Lenient on
 * purpose: Rust validates the rest on save and names the offending entry.
 */
function parseLists<T extends { documentTypes: unknown[]; jobKinds: unknown[] }>(
  text: string,
  empty: T
): { value: T } | { error: string } {
  if (text.trim() === '') return { value: empty };
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { error: 'The configuration is a JSON object with documentTypes and jobKinds.' };
    }
    const raw = value as Partial<T>;
    return {
      value: { ...raw, documentTypes: raw.documentTypes ?? [], jobKinds: raw.jobKinds ?? [] } as T,
    };
  } catch (reason) {
    return { error: `Not JSON: ${reasonText(reason)}` };
  }
}

interface JsonEditorProps<T extends { documentTypes: unknown[]; jobKinds: unknown[] }> {
  label: string;
  stored: T;
  empty: T;
  example: string;
  testId: string;
  saveTestId: string;
  /** One short line under the field; the rest goes in `details`, behind "Learn more". */
  hint: React.ReactNode;
  details?: React.ReactNode;
  onSave: (value: T) => Promise<string | null>;
}

/**
 * A JSON textarea with Save. The parent keys it by what is stored, so a save
 * Rust kept starts it afresh from what Rust read back.
 */
function JsonEditor<T extends { documentTypes: unknown[]; jobKinds: unknown[] }>({
  label,
  stored,
  empty,
  example,
  testId,
  saveTestId,
  hint,
  details,
  onSave,
}: JsonEditorProps<T>) {
  const id = useId();
  const storedText = formatJson(stored);
  const [text, setText] = useState(storedText);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const parsed = parseLists(text, empty);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(await onSave(parsed.value));
  };

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[11px] font-semibold text-foreground">
        {label}
      </label>
      <textarea
        id={id}
        data-testid={testId}
        aria-describedby={`${id}-hint`}
        aria-invalid={error !== null}
        value={text}
        rows={6}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        placeholder={example}
        className={TEXTAREA_CLASS}
      />
      <p id={`${id}-hint`} className={SETTINGS_HINT_CLASS}>
        {hint}
      </p>
      {details && <LearnMore>{details}</LearnMore>}
      {error && (
        <p role="alert" className="text-[11px] text-red-400">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void save()}
        disabled={text === storedText}
        title={text === storedText ? 'Nothing changed' : undefined}
        data-testid={saveTestId}
        className={SAVE_CLASS}
      >
        Save
      </button>
    </div>
  );
}

/** What every shared project inherits unless its own entry says otherwise. */
function GlobalDefaults({
  defaults,
  onSave,
}: {
  defaults: LinkDefaults;
  onSave: (defaults: LinkDefaults) => Promise<string | null>;
}) {
  return (
    <SettingsGroup>
      <JsonEditor
        key={JSON.stringify(defaults)}
        label="Global defaults: document types and job kinds (JSON)"
        stored={defaults}
        empty={{ documentTypes: [], jobKinds: [] }}
        example={DEFAULTS_EXAMPLE}
        testId="supervisor-link-defaults"
        saveTestId="supervisor-link-defaults-save"
        onSave={onSave}
        hint="Every shared project inherits these."
        details={
          <p>
            Globs and <code>instructions</code> are relative to each project;{' '}
            <code>globalInstructions</code> is an absolute path or a file name in the app data
            folder&apos;s <code>job-kinds/</code>. The IDE reads that file itself and puts it into
            the job prompt; it is never served to clients.
          </p>
        }
      />
    </SettingsGroup>
  );
}

interface ProjectRowProps {
  name: string;
  path: string;
  entry: [string, LinkProjectEntry] | null;
  usedToday: number;
  effective: EffectiveLinkPolicy | null;
  effectiveFailure: string | null;
  onSave: (entry: LinkProjectEntry | null) => Promise<string | null>;
}

/** One starred project: shared or not, its own entry, and what it effectively offers. */
function ProjectRow({
  name,
  path,
  entry,
  usedToday,
  effective,
  effectiveFailure,
  onSave,
}: ProjectRowProps) {
  const [toggleError, setToggleError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <SettingsToggle
        label={name}
        description={path}
        checked={entry !== null}
        onChange={(on) =>
          void onSave(on ? EMPTY_ENTRY : null).then((refused) => setToggleError(refused))
        }
        testId={`supervisor-link-project-${name}`}
      />
      {toggleError && (
        <p role="alert" className="pl-4 text-[11px] text-red-400">
          {toggleError}
        </p>
      )}
      {entry && (
        <div className="space-y-2 pl-4">
          <JsonEditor
            key={JSON.stringify(entry)}
            label="This project's entry (JSON)"
            stored={entry[1]}
            empty={EMPTY_ENTRY}
            example={ENTRY_EXAMPLE}
            testId={`supervisor-link-config-${name}`}
            saveTestId={`supervisor-link-save-${name}`}
            onSave={onSave}
            hint={
              <>
                Empty: every global default, nothing else. Jobs here in the last 24 hours:{' '}
                <span className="tabular-nums">{usedToday}</span>.
              </>
            }
            details={
              <p>
                A document type or job kind with a default&apos;s name overrides it, a new name adds
                one. <code>inherit: false</code> drops all defaults,{' '}
                <code>disabledDocumentTypes</code> and <code>disabledJobKinds</code> drop single
                ones, <code>dailyLimit</code> sets this project&apos;s jobs per 24 h. The agent may
                only write a kind&apos;s <code>writes</code> (default: the document globs);{' '}
                <code>assets</code> globs are read-only.
              </p>
            }
          />
          <EffectiveProject
            name={name}
            path={path}
            effective={effective}
            failure={effectiveFailure}
          />
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
    <SettingsGroup
      title="Job counter"
      description="A guard against a client starting jobs in a loop, not a budget: jobs started in any 24 hours. 0 switches jobs off. Empty per-project limit: none."
    >
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
    </SettingsGroup>
  );
}

/**
 * The supervisor link (`docs/design-supervisor-link.md`): a client of the
 * Supervisor Control API talks to supervisors over a local socket, reads and
 * proposes JSON documents and starts jobs in the projects shared here. What a
 * document or a job is comes from the global defaults, overridden or extended
 * per project; every change arrives as a branch for review. A supervisor may
 * propose a change to these settings, which a person applies or discards.
 */
export function SupervisorLinkSettings() {
  const starredProjects = useStore((s) => s.starredProjects);
  const showToast = useStore((s) => s.showToast);
  const [policy, setPolicy] = useState<StoredLinkPolicy | null>(null);
  const [effective, setEffective] = useState<EffectiveLinkPolicy | null>(null);
  const [effectiveFailure, setEffectiveFailure] = useState<string | null>(null);
  const [proposals, setProposals] = useState<PolicyProposals | null>(null);
  const [usage, setUsage] = useState<JobsUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const applyEffective = useCallback((loaded: EffectiveLinkPolicy) => {
    if (!alive.current) return;
    setEffective(loaded);
    setEffectiveFailure(null);
  }, []);

  const failEffective = useCallback((reason: unknown) => {
    if (alive.current) setEffectiveFailure(reasonText(reason));
  }, []);

  const applyProposals = useCallback((loaded: PolicyProposals) => {
    if (alive.current) setProposals(loaded);
  }, []);

  const applyPolicy = useCallback((loaded: StoredLinkPolicy) => {
    if (alive.current) setPolicy(loaded);
  }, []);

  const failPolicy = useCallback((reason: unknown) => {
    if (alive.current) setError(reasonText(reason));
  }, []);

  /** Reads the merged configuration again, after anything that may change it. */
  const reloadEffective = () => supervisorLinkPolicyEffective().then(applyEffective, failEffective);

  // A failed proposals read leaves the block as it was; the settings still work.
  const reloadProposals = () => supervisorLinkProposals().then(applyProposals, () => {});

  useEffect(() => {
    alive.current = true;
    supervisorLinkPolicyGet().then(applyPolicy, failPolicy);
    supervisorLinkPolicyEffective().then(applyEffective, failEffective);
    supervisorLinkProposals().then(applyProposals, () => {});
    supervisorLinkJobsUsage()
      .then((loaded) => alive.current && setUsage(loaded))
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, [applyPolicy, failPolicy, applyEffective, failEffective, applyProposals]);

  /** Stores `next`; answers Rust's refusal, or null when it was stored. */
  const store = async (next: StoredLinkPolicy): Promise<string | null> => {
    try {
      setPolicy(await supervisorLinkPolicySet(next));
    } catch (reason) {
      return reasonText(reason);
    }
    void reloadEffective();
    return null;
  };

  const saveDefaults = async (defaults: LinkDefaults) =>
    policy ? await store({ ...policy, defaults }) : null;

  const saveProject = (path: string) => async (entry: LinkProjectEntry | null) => {
    if (!policy) return null;
    const rest = withoutProject(policy, path);
    const key = entryFor(policy, path)?.[0] ?? path;
    return await store(entry ? { ...rest, projects: { ...rest.projects, [key]: entry } } : rest);
  };

  const saveLimits = (limits: JobLimits) => {
    if (!policy) return;
    void store({ ...policy, jobs: limits }).then(
      (refused) => refused && showToast(`Could not save the job limit: ${refused}`, 'error')
    );
  };

  /** Applies or discards; answers Rust's refusal. Everything is read again either way. */
  const decide = async (proposalId: string, decision: ProposalDecision) => {
    let refused: string | null = null;
    try {
      await supervisorLinkProposalDecide(proposalId, decision);
      showToast(decision === 'apply' ? 'Proposal applied' : 'Proposal discarded', 'success');
    } catch (reason) {
      refused = reasonText(reason);
    }
    await Promise.all([
      supervisorLinkPolicyGet().then(applyPolicy, failPolicy),
      reloadEffective(),
      reloadProposals(),
    ]);
    return refused;
  };

  const used = (path: string) => {
    const wanted = normalizeProjectPath(path);
    return Object.entries(usage?.byProject ?? {})
      .filter(([listed]) => normalizeProjectPath(listed) === wanted)
      .reduce((sum, [, count]) => sum + count, 0);
  };

  return (
    <SettingsSection title="Supervisor link" icon="hub">
      <div className="space-y-1">
        <p className={SETTINGS_HINT_CLASS}>
          Lets a local app talk to supervisors over a socket and work in the projects you share
          below. Every change it makes arrives as a branch you merge or delete.
        </p>
        <LearnMore>
          <p>
            A client of the Supervisor Control API can start and talk to supervisors and their
            agents over a local socket. It sees nothing you started in the IDE. In the projects you
            share below it may read the JSON documents described for them and start the job kinds
            they offer. Every change it proposes and every job result arrives as a branch you merge
            or delete.
          </p>
        </LearnMore>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          Could not read the supervisor link settings: {error}
        </p>
      ) : !policy ? (
        <p className="text-xs text-foreground-muted">Loading…</p>
      ) : (
        <>
          <JobCounter limits={policy.jobs} usage={usage} onSave={saveLimits} />
          <GlobalDefaults defaults={policy.defaults} onSave={saveDefaults} />
          {starredProjects.length === 0 ? (
            <p className={SETTINGS_HINT_CLASS}>
              Star a project in Quick Access to share it with the link.
            </p>
          ) : (
            <SettingsGroup
              title="Shared projects"
              description="Switch a project on to let the link read its documents and run its jobs."
            >
              {starredProjects.map((project) => (
                <ProjectRow
                  key={project.path}
                  name={project.name}
                  path={project.path}
                  entry={entryFor(policy, project.path)}
                  usedToday={used(project.path)}
                  effective={effective}
                  effectiveFailure={effectiveFailure}
                  onSave={saveProject(project.path)}
                />
              ))}
            </SettingsGroup>
          )}
          <ProposalsBlock proposals={proposals} onDecide={decide} />
        </>
      )}
    </SettingsSection>
  );
}
