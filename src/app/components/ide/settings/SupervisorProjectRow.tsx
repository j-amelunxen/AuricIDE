'use client';

import { useId, type ReactNode } from 'react';
import { isProviderAllowed, type ProviderPolicy } from '@/lib/config/providerPolicy';
import {
  MAX_PROVIDER_NOTE_LENGTH,
  MAX_PROVIDER_WEIGHT,
  providerNoteLength,
  trimProviderNote,
  type SupervisorProjectPolicy,
} from '@/lib/config/supervisorPolicy';
import {
  offerablePermissionModes,
  setSupervisorPermissionMode,
  setSupervisorProviderNote,
  setSupervisorProviderWeight,
  toggleSupervisorModel,
  toggleSupervisorProvider,
} from '@/lib/config/supervisorPolicyEdit';
import { modelSizeLabel } from '@/lib/agents/supervisorLaunchPrompt';
import { isModelAvailable, type ModelOption, type ProviderInfo } from '@/lib/tauri/providers';
import type { StarredProject } from '@/lib/tauri/starredProjects';
import { DESCRIPTION_MAX_CHARS } from '@/lib/quickAccess/description';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import {
  SETTINGS_HINT_CLASS,
  SETTINGS_LABEL_CLASS,
} from '@/app/components/ui/settings/SettingsGroup';
import { SettingsSwitch } from '@/app/components/ui/settings/SettingsSwitch';
import { SettingsToggle } from '@/app/components/ui/settings/SettingsToggle';
import { SupervisorExtraMcp } from './SupervisorExtraMcp';

const DENIED_REASON = "Blocked by this project's own provider settings";

/** Smallest first, models without a size last — the order the supervisor is told to pick in. */
export function byModelRank(models: ModelOption[]): ModelOption[] {
  const known = (rank: number | null | undefined) =>
    typeof rank === 'number' && rank >= 1 ? rank : Infinity;
  return [...models].sort((a, b) => known(a.rank) - known(b.rank));
}

export const SELECT_CLASS =
  'rounded border border-border-dark bg-editor-bg px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none';

export const NUMBER_CLASS = `${SELECT_CLASS} w-16 tabular-nums`;

const TEXTAREA_CLASS =
  'w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground placeholder:text-foreground-muted/60 focus:border-primary focus:outline-none';

/** `/Users/<name>/…` and `/home/<name>/…` read as `~/…`; the full path stays in the tooltip. */
function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
}

/** The providers the supervisor may actually start here: ticked and not denied by the project. */
function usableProviders(
  entry: SupervisorProjectPolicy,
  providers: ProviderInfo[],
  projectPolicy: ProviderPolicy | undefined
): ProviderInfo[] {
  return providers.filter(
    (p) =>
      (!projectPolicy || isProviderAllowed(p.id, projectPolicy)) &&
      (entry.providers?.includes(p.id) ?? true)
  );
}

/**
 * One line that says what a project is set to without opening it: "Off", or the providers
 * (with their shares when any is set), interactive or headless, the running limit and how
 * many routing notes it has.
 */
function projectSummary(
  entry: SupervisorProjectPolicy | undefined,
  providers: ProviderInfo[],
  projectPolicy: ProviderPolicy | undefined
): string {
  if (!entry?.allowed) return 'Off';
  const usable = usableProviders(entry, providers, projectPolicy);
  const weights = usable.map((p) => entry.providerWeights[p.id] ?? 0);
  const parts = [
    usable.length === 0 ? 'No provider' : usable.map((p) => p.name).join(', '),
    ...(weights.some((w) => w > 0) ? [`shares ${weights.join(':')}`] : []),
    entry.allowInteractive ? 'interactive' : 'headless only',
    `max ${entry.maxRunning} running`,
  ];
  const notes = usable.filter((p) => entry.providerNotes[p.id]?.trim()).length;
  if (notes > 0) parts.push(notes === 1 ? '1 routing note' : `${notes} routing notes`);
  return parts.join(' · ');
}

/** Bolds the characters the filter matched, so it is clear why a row is listed. */
function Highlighted({ text, indices }: { text: string; indices: readonly number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const hit = new Set(indices);
  return (
    <>
      {text.split('').map((char, index) =>
        hit.has(index) ? (
          <mark key={index} className="bg-transparent font-semibold text-primary-light">
            {char}
          </mark>
        ) : (
          <span key={index}>{char}</span>
        )
      )}
    </>
  );
}

interface SupervisorProjectRowProps {
  project: StarredProject;
  entry: SupervisorProjectPolicy | undefined;
  providers: ProviderInfo[];
  /** The project's own provider policy; `undefined` (no backend) counts as the open default, as in Rust. */
  projectPolicy: ProviderPolicy | undefined;
  /** The draft of the project's own description, the one Quick Access edits too. */
  description: string;
  expanded: boolean;
  /** Something on this row differs from what is saved. */
  edited: boolean;
  /** How many ticked providers would run without asking; Save stays blocked while any do. */
  attention: number;
  /** Name offsets the filter matched. */
  matchIndices?: readonly number[];
  onExpandedChange: (expanded: boolean) => void;
  onDescriptionChange: (description: string) => void;
  onAllowedChange: (allowed: boolean) => void;
  onChange: (entry: SupervisorProjectPolicy) => void;
}

/**
 * One starred project as a list row: name, short path, a one-line summary and the switch,
 * with the full editor behind a disclosure. Thirty projects fully expanded were an endless
 * page; collapsed they are an overview, and the editor is one click away.
 */
// code-gate: complexity-parameter-count - one props object; each prop is a named field, not a positional parameter
export function SupervisorProjectRow({
  project,
  entry,
  providers,
  projectPolicy,
  description,
  expanded,
  edited,
  attention,
  matchIndices = [],
  onExpandedChange,
  onDescriptionChange,
  onAllowedChange,
  onChange,
}: SupervisorProjectRowProps) {
  const allowed = entry?.allowed === true;
  const editorId = useId();

  return (
    <li
      data-testid={`supervisor-project-${project.path}`}
      className={`rounded-xl border transition-colors ${
        expanded ? 'border-white/10 bg-white/[0.03]' : 'border-white/[0.06] bg-white/[0.015]'
      }`}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={editorId}
          data-testid={`supervisor-project-disclosure-${project.path}`}
          onClick={() => onExpandedChange(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-0.5 text-left"
        >
          <AuricIcon
            name="chevron_right"
            aria-hidden="true"
            className={`shrink-0 text-sm text-foreground-muted transition-transform duration-150 ${
              expanded ? 'rotate-90' : ''
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-xs font-medium text-foreground">
                <Highlighted text={project.name} indices={matchIndices} />
              </span>
              <span
                title={project.path}
                className="min-w-0 truncate font-mono text-[10px] text-foreground-muted/70"
              >
                {shortenPath(project.path)}
              </span>
            </span>
            <span
              data-testid={`supervisor-project-summary-${project.path}`}
              className="block truncate text-[11px] text-foreground-muted"
            >
              {projectSummary(entry, providers, projectPolicy)}
            </span>
          </span>
          <RowMarkers edited={edited} attention={attention} />
        </button>
        <SettingsSwitch
          checked={allowed}
          onChange={onAllowedChange}
          ariaLabel={`Supervisor may use ${project.name}`}
          testId={`supervisor-allowed-${project.path}`}
        />
      </div>
      {expanded && (
        <div id={editorId} className="border-t border-white/5 px-3 pb-3">
          {allowed && entry ? (
            <ProjectEditor
              project={project}
              entry={entry}
              providers={providers}
              projectPolicy={projectPolicy}
              description={description}
              onDescriptionChange={onDescriptionChange}
              onChange={onChange}
            />
          ) : (
            <p className={`pt-3 ${SETTINGS_HINT_CLASS}`}>
              The supervisor may not start agents here. Switch it on to choose providers, models and
              limits.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** "Edited" and "needs a permission mode" stay visible on the collapsed row. */
function RowMarkers({ edited, attention }: { edited: boolean; attention: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {attention > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300">
          <AuricIcon name="error" aria-hidden="true" className="text-[11px]" />
          Needs a permission mode
        </span>
      )}
      {edited && (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary-light">
          Edited
        </span>
      )}
    </span>
  );
}

/** One titled block of the editor; blocks are separated by a hairline, not boxed in boxes. */
function EditorBlock({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 pt-3">
      {title && <h5 className={SETTINGS_LABEL_CLASS}>{title}</h5>}
      {hint && <p className={SETTINGS_HINT_CLASS}>{hint}</p>}
      {children}
    </div>
  );
}

interface ProjectEditorProps {
  project: StarredProject;
  entry: SupervisorProjectPolicy;
  providers: ProviderInfo[];
  projectPolicy: ProviderPolicy | undefined;
  description: string;
  onDescriptionChange: (description: string) => void;
  onChange: (entry: SupervisorProjectPolicy) => void;
}

// code-gate: complexity-parameter-count - one props object; each prop is a named field, not a positional parameter
/** The editor of an allowed project: description, providers and models, agents, MCP servers. */
function ProjectEditor({
  project,
  entry,
  providers,
  projectPolicy,
  description,
  onDescriptionChange,
  onChange,
}: ProjectEditorProps) {
  const permittedHere = (id: string) => !projectPolicy || isProviderAllowed(id, projectPolicy);
  const candidates = providers.filter((p) => permittedHere(p.id)).map((p) => p.id);

  return (
    <div className="space-y-3 divide-y divide-white/5">
      <EditorBlock>
        <DescriptionField path={project.path} value={description} onChange={onDescriptionChange} />
      </EditorBlock>
      <EditorBlock
        title="Providers and models"
        hint="The CLIs the supervisor may start here. A ticked one shows its models, permission mode, share and routing note."
      >
        <fieldset className="space-y-1">
          <legend className="sr-only">Providers and models</legend>
          {providers.map((provider) => (
            <ProviderBlock
              key={provider.id}
              testKey={`${project.path}-${provider.id}`}
              provider={provider}
              entry={entry}
              denied={!permittedHere(provider.id)}
              onToggle={(on) =>
                onChange(toggleSupervisorProvider(entry, provider.id, on, candidates))
              }
              onChange={onChange}
            />
          ))}
        </fieldset>
        <BalancingSummary
          testId={`supervisor-balancing-${project.path}`}
          providers={usableProviders(entry, providers, projectPolicy)}
          weights={entry.providerWeights}
        />
      </EditorBlock>
      <EditorBlock title="Agents">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="min-w-[14rem] flex-1">
            <SettingsToggle
              label="Interactive agents"
              description="Long work in a terminal you can answer. Off: headless only."
              checked={entry.allowInteractive}
              onChange={(on) => onChange({ ...entry, allowInteractive: on })}
              testId={`supervisor-interactive-${project.path}`}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground">
            Max running
            <input
              type="number"
              min={0}
              step={1}
              data-testid={`supervisor-max-running-${project.path}`}
              value={entry.maxRunning}
              onChange={(e) =>
                onChange({
                  ...entry,
                  maxRunning: Math.max(0, Math.floor(Number(e.target.value))),
                })
              }
              className={NUMBER_CLASS}
            />
          </label>
        </div>
      </EditorBlock>
      <EditorBlock>
        <SupervisorExtraMcp projectPath={project.path} entry={entry} onChange={onChange} />
      </EditorBlock>
    </div>
  );
}

/**
 * The supervisor picks a project by what `list_projects` says about it, and a
 * folder name alone ("tools-v2") rarely says enough. This is the starred
 * project's own description, so it is the same text whichever page edits it.
 */
function DescriptionField({
  path,
  value,
  onChange,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `supervisor-description-${path}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={`block ${SETTINGS_LABEL_CLASS}`}>
        Description
      </label>
      <textarea
        id={id}
        data-testid={id}
        aria-describedby={`${id}-hint`}
        value={value}
        maxLength={DESCRIPTION_MAX_CHARS}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What this project is for, and anything an agent should know first"
        className={TEXTAREA_CLASS}
      />
      <p id={`${id}-hint`} className={`flex justify-between gap-2 ${SETTINGS_HINT_CLASS}`}>
        <span>
          The supervisor reads this to choose where to start agents. Empty: the README is used.
        </span>
        <span className="tabular-nums">
          {Array.from(value).length}/{DESCRIPTION_MAX_CHARS}
        </span>
      </p>
    </div>
  );
}

/**
 * The split the shares make among the ticked providers, in percent. The
 * supervisor is shown the same weights and, in `list_projects`, which provider
 * is behind; it may still pick another when a task needs that one's model.
 */
function BalancingSummary({
  testId,
  providers,
  weights,
}: {
  testId: string;
  providers: ProviderInfo[];
  weights: Record<string, number>;
}) {
  const total = providers.reduce((sum, p) => sum + (weights[p.id] ?? 0), 0);
  return (
    <p data-testid={testId} className={SETTINGS_HINT_CLASS}>
      {total === 0 ? (
        <>
          No load balancing. Give providers a share to balance them, e.g. 2 and 1 for twice as many
          agents of the first.
        </>
      ) : (
        <>
          <span className="text-foreground">Load balancing: </span>
          {providers
            .map((p) => `${p.name} ${Math.round(((weights[p.id] ?? 0) * 100) / total)} %`)
            .join(' · ')}{' '}
          of the agents started here over 7 days. The supervisor follows it unless a task needs a
          model only another provider has.
        </>
      )}
    </p>
  );
}

interface ProviderBlockProps {
  /** `<project path>-<provider id>`, the suffix of every test id in the block. */
  testKey: string;
  provider: ProviderInfo;
  entry: SupervisorProjectPolicy;
  denied: boolean;
  onToggle: (on: boolean) => void;
  onChange: (entry: SupervisorProjectPolicy) => void;
}

const FIELD_GRID = 'grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5';
const FIELD_LABEL = 'pt-1 text-[11px] text-foreground-muted';

/** Unticked, a provider is one line; ticked, its settings sit on one label/control grid. */
function ProviderBlock({
  testKey,
  provider,
  entry,
  denied,
  onToggle,
  onChange,
}: ProviderBlockProps) {
  const checked = !denied && (entry.providers?.includes(provider.id) ?? true);
  const fieldId = useId();

  return (
    <div
      className={`rounded-lg px-2 py-1.5 ${checked ? 'bg-white/[0.03]' : 'hover:bg-white/[0.03]'}`}
    >
      <label
        className={`flex items-center gap-2.5 text-xs ${denied ? 'text-foreground-muted' : 'text-foreground'}`}
        title={denied ? DENIED_REASON : undefined}
      >
        <input
          type="checkbox"
          data-testid={`supervisor-provider-${testKey}`}
          checked={checked}
          disabled={denied}
          onChange={(e) => onToggle(e.target.checked)}
          className="accent-[var(--primary)]"
        />
        <span className={checked ? 'font-medium' : undefined}>{provider.name}</span>
        {denied && <span className="text-[10px] text-foreground-muted">· {DENIED_REASON}</span>}
      </label>
      {checked && (
        <div className={`mt-2.5 pb-1 pl-6 ${FIELD_GRID}`}>
          <span className={FIELD_LABEL}>Models</span>
          <ModelChips testKey={testKey} provider={provider} entry={entry} onChange={onChange} />
          <PermissionModeField
            testKey={testKey}
            fieldId={`${fieldId}-permission`}
            provider={provider}
            entry={entry}
            onChange={onChange}
          />
          <label htmlFor={`${fieldId}-share`} className={FIELD_LABEL}>
            Load-balancing share
          </label>
          <input
            id={`${fieldId}-share`}
            type="number"
            min={0}
            max={MAX_PROVIDER_WEIGHT}
            step={1}
            placeholder="–"
            aria-label={`${provider.name} load-balancing share`}
            data-testid={`supervisor-weight-${testKey}`}
            value={entry.providerWeights[provider.id] ?? ''}
            onChange={(e) =>
              onChange(
                setSupervisorProviderWeight(
                  entry,
                  provider.id,
                  e.target.value === '' ? null : Number(e.target.value)
                )
              )
            }
            className={NUMBER_CLASS}
          />
          <RoutingNoteField
            testKey={testKey}
            fieldId={`${fieldId}-note`}
            provider={provider}
            entry={entry}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

function ModelChips({
  testKey,
  provider,
  entry,
  onChange,
}: {
  testKey: string;
  provider: ProviderInfo;
  entry: SupervisorProjectPolicy;
  onChange: (entry: SupervisorProjectPolicy) => void;
}) {
  const offered = provider.models.filter(isModelAvailable).map((m) => m.value);
  const chosen = entry.models[provider.id];
  const orphanIds = (chosen ?? []).filter(
    (id) => !provider.models.some((model) => model.value === id)
  );
  return (
    <div className="space-y-1.5">
      <div role="group" aria-label={`${provider.name} models`} className="flex flex-wrap gap-1.5">
        {byModelRank(provider.models).map((model) => {
          const available = isModelAvailable(model);
          const on = available && (chosen?.includes(model.value) ?? true);
          return (
            <label
              key={model.value}
              title={
                available ? undefined : 'No longer offered by this CLI — left in settings unchanged'
              }
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/60 ${
                !available
                  ? 'cursor-not-allowed border-amber-500/30 bg-amber-500/5 text-foreground-muted line-through'
                  : on
                    ? 'cursor-pointer border-primary/40 bg-primary/10 text-foreground'
                    : 'cursor-pointer border-white/10 bg-white/5 text-foreground-muted hover:text-foreground'
              }`}
            >
              <input
                type="checkbox"
                data-testid={`supervisor-model-${testKey}-${model.value}`}
                checked={on}
                disabled={!available}
                onChange={(e) =>
                  onChange(
                    toggleSupervisorModel(
                      entry,
                      provider.id,
                      model.value,
                      e.target.checked,
                      offered
                    )
                  )
                }
                className="sr-only"
              />
              <span>{model.label}</span>
              {!available && (
                <span className="text-[9px] text-amber-400 no-underline">unavailable</span>
              )}
              {available && (
                <span className="text-[9px] text-foreground-muted">
                  {modelSizeLabel(model.rank)}
                </span>
              )}
            </label>
          );
        })}
        {orphanIds.map((id) => (
          <span
            key={`orphan-${id}`}
            data-testid={`supervisor-model-orphan-${testKey}-${id}`}
            title="In your policy, but missing from the provider catalog"
            className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] text-foreground-muted line-through"
          >
            {id} <span className="text-[9px] text-amber-400 no-underline">unavailable</span>
          </span>
        ))}
      </div>
      {chosen?.length === 0 && (
        <p className="text-[10px] text-foreground-muted">
          No model selected, so the supervisor cannot use {provider.name} here.
        </p>
      )}
    </div>
  );
}

interface ProviderFieldProps {
  testKey: string;
  fieldId: string;
  provider: ProviderInfo;
  entry: SupervisorProjectPolicy;
  onChange: (entry: SupervisorProjectPolicy) => void;
}

/**
 * The select offers only modes that ask. A provider whose own default skips
 * prompts is the one case it cannot settle by leaving the field alone, so the
 * row says so until a mode is named.
 */
function PermissionModeField({ testKey, fieldId, provider, entry, onChange }: ProviderFieldProps) {
  const modes = offerablePermissionModes(provider.permissionModes);
  const defaultMode = provider.permissionModes.find(
    (mode) => mode.value === provider.defaultPermissionMode
  );
  const defaultUnattended = defaultMode?.unattended === true;
  const needsMode = defaultUnattended && !entry.permissionMode[provider.id];

  return (
    <>
      <label htmlFor={fieldId} className={FIELD_LABEL}>
        Permission mode
      </label>
      <div className="space-y-1">
        <select
          id={fieldId}
          data-testid={`supervisor-permission-${testKey}`}
          value={entry.permissionMode[provider.id] ?? ''}
          onChange={(e) =>
            onChange(setSupervisorPermissionMode(entry, provider.id, e.target.value || null))
          }
          className={SELECT_CLASS}
        >
          <option value="" disabled={defaultUnattended}>
            {defaultUnattended ? 'Provider default (skips prompts)' : 'Provider default'}
          </option>
          {modes.map((mode) => (
            <option key={mode.value} value={mode.value} title={mode.description}>
              {mode.label}
            </option>
          ))}
        </select>
        {needsMode && (
          <p
            data-testid={`supervisor-unattended-${testKey}`}
            className="text-[10px] leading-snug text-red-400"
          >
            {provider.name}&apos;s default mode,{' '}
            {defaultMode?.label ?? provider.defaultPermissionMode}, runs without asking. Pick a mode
            that asks, or untick {provider.name}.
          </p>
        )}
      </div>
    </>
  );
}

/** Counted as the parser counts it: code points of the trimmed text. */
const noteLength = providerNoteLength;

/**
 * Cuts a note to what the parser accepts. A note over the limit makes Rust reject the whole
 * project, so the field never holds one. `maxLength` counts UTF-16 units, not code points,
 * hence the cut by hand; leading whitespace is kept while typing, since the parser trims it.
 */
function capNote(text: string): string {
  if (noteLength(text) <= MAX_PROVIDER_NOTE_LENGTH) return text;
  const kept = trimProviderNote(text);
  const lead = text.indexOf(kept);
  return text.slice(0, lead) + [...kept].slice(0, MAX_PROVIDER_NOTE_LENGTH).join('');
}

/** When this provider is the right pick here, in the user's words; the supervisor reads it. */
function RoutingNoteField({ testKey, fieldId, provider, entry, onChange }: ProviderFieldProps) {
  const value = entry.providerNotes[provider.id] ?? '';
  return (
    <>
      <label htmlFor={fieldId} className={FIELD_LABEL}>
        Routing note
      </label>
      <div className="space-y-1">
        <textarea
          id={fieldId}
          data-testid={`supervisor-note-${testKey}`}
          aria-describedby={`${fieldId}-hint`}
          value={value}
          rows={2}
          onChange={(e) =>
            onChange(setSupervisorProviderNote(entry, provider.id, capNote(e.target.value) || null))
          }
          placeholder="When should the supervisor pick this provider here? e.g. only for source-code changes, no database access"
          className={TEXTAREA_CLASS}
        />
        <p id={`${fieldId}-hint`} className={`flex justify-between gap-2 ${SETTINGS_HINT_CLASS}`}>
          <span>
            The supervisor reads this when it picks a provider for a task in this project.
          </span>
          <span className="tabular-nums">
            {noteLength(value)}/{MAX_PROVIDER_NOTE_LENGTH}
          </span>
        </p>
      </div>
    </>
  );
}
