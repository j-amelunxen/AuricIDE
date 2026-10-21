'use client';

import { isProviderAllowed, type ProviderPolicy } from '@/lib/config/providerPolicy';
import { MAX_PROVIDER_WEIGHT, type SupervisorProjectPolicy } from '@/lib/config/supervisorPolicy';
import {
  offerablePermissionModes,
  setSupervisorPermissionMode,
  setSupervisorProviderWeight,
  toggleSupervisorModel,
  toggleSupervisorProvider,
} from '@/lib/config/supervisorPolicyEdit';
import { modelSizeLabel } from '@/lib/agents/supervisorLaunchPrompt';
import {
  isModelAvailable,
  type ModelOption,
  type ProviderInfo,
} from '@/lib/tauri/providers';
import type { StarredProject } from '@/lib/tauri/starredProjects';
import { DESCRIPTION_MAX_CHARS } from '@/lib/quickAccess/description';
import { SettingsToggle } from '@/app/components/ui/settings/SettingsToggle';

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

interface SupervisorProjectRowProps {
  project: StarredProject;
  entry: SupervisorProjectPolicy | undefined;
  providers: ProviderInfo[];
  /** The project's own provider policy; `undefined` (no backend) counts as the open default, as in Rust. */
  projectPolicy: ProviderPolicy | undefined;
  /** The draft of the project's own description, the one Quick Access edits too. */
  description: string;
  onDescriptionChange: (description: string) => void;
  onAllowedChange: (allowed: boolean) => void;
  onChange: (entry: SupervisorProjectPolicy) => void;
}

/**
 * One starred project: may the supervisor use it, and with what. Everything
 * below the switch only shows while it is on — an off project has nothing to
 * tune, and five greyed-out controls would read as five decisions to make.
 */
// code-gate: complexity-parameter-count - one props object; each prop is a named field, not a positional parameter
export function SupervisorProjectRow({
  project,
  entry,
  providers,
  projectPolicy,
  description,
  onDescriptionChange,
  onAllowedChange,
  onChange,
}: SupervisorProjectRowProps) {
  const allowed = entry?.allowed === true;
  const permittedHere = (id: string) => !projectPolicy || isProviderAllowed(id, projectPolicy);
  const candidates = providers.filter((p) => permittedHere(p.id)).map((p) => p.id);

  return (
    <div
      data-testid={`supervisor-project-${project.path}`}
      className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3"
    >
      <SettingsToggle
        label={project.name}
        description={project.path}
        checked={allowed}
        onChange={onAllowedChange}
        testId={`supervisor-allowed-${project.path}`}
      />
      {allowed && entry && (
        <div className="space-y-3 border-t border-white/5 pt-3">
          <DescriptionField
            path={project.path}
            value={description}
            onChange={onDescriptionChange}
          />
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[10px] font-semibold tracking-wide text-foreground-muted">
              Providers and models
            </legend>
            {providers.map((provider) => {
              return (
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
              );
            })}
          </fieldset>
          <BalancingSummary
            testId={`supervisor-balancing-${project.path}`}
            providers={providers.filter(
              (p) => permittedHere(p.id) && (entry.providers?.includes(p.id) ?? true)
            )}
            weights={entry.providerWeights}
          />
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
        </div>
      )}
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
      <label
        htmlFor={id}
        className="block text-[10px] font-semibold tracking-wide text-foreground-muted"
      >
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
        className="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground placeholder:text-foreground-muted/60 focus:border-primary focus:outline-none"
      />
      <p id={`${id}-hint`} className="flex justify-between gap-2 text-[10px] text-foreground-muted">
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
    <p data-testid={testId} className="px-2 text-[10px] leading-snug text-foreground-muted">
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

function ProviderBlock({
  testKey,
  provider,
  entry,
  denied,
  onToggle,
  onChange,
}: ProviderBlockProps) {
  const checked = !denied && (entry.providers?.includes(provider.id) ?? true);
  const offered = provider.models.filter(isModelAvailable).map((m) => m.value);
  const chosen = entry.models[provider.id];
  const orphanIds = (chosen ?? []).filter(
    (id) => !provider.models.some((model) => model.value === id)
  );

  return (
    <div className="rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
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
        <span>{provider.name}</span>
        {denied && <span className="text-[10px] text-foreground-muted">— {DENIED_REASON}</span>}
      </label>
      {checked && (
        <div className="mt-2 space-y-2 pl-6">
          <div
            role="group"
            aria-label={`${provider.name} models`}
            className="flex flex-wrap gap-1.5"
          >
            {byModelRank(provider.models).map((model) => {
              const available = isModelAvailable(model);
              const on = available && (chosen?.includes(model.value) ?? true);
              return (
                <label
                  key={model.value}
                  title={
                    available
                      ? undefined
                      : 'No longer offered by this CLI — left in settings unchanged'
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
                {id}{' '}
                <span className="text-[9px] text-amber-400 no-underline">unavailable</span>
              </span>
            ))}
          </div>
          {chosen?.length === 0 && (
            <p className="text-[10px] text-foreground-muted">
              No model selected, so the supervisor cannot use {provider.name} here.
            </p>
          )}
          <PermissionModeField
            testKey={testKey}
            provider={provider}
            entry={entry}
            onChange={onChange}
          />
          <label className="flex items-center gap-2 text-[11px] text-foreground-muted">
            Load-balancing share
            <input
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
          </label>
        </div>
      )}
    </div>
  );
}

interface PermissionModeFieldProps {
  testKey: string;
  provider: ProviderInfo;
  entry: SupervisorProjectPolicy;
  onChange: (entry: SupervisorProjectPolicy) => void;
}

/**
 * The select offers only modes that ask. A provider whose own default skips
 * prompts is the one case it cannot settle by leaving the field alone, so the
 * row says so until a mode is named.
 */
function PermissionModeField({ testKey, provider, entry, onChange }: PermissionModeFieldProps) {
  const modes = offerablePermissionModes(provider.permissionModes);
  const defaultMode = provider.permissionModes.find(
    (mode) => mode.value === provider.defaultPermissionMode
  );
  const defaultUnattended = defaultMode?.unattended === true;
  const needsMode = defaultUnattended && !entry.permissionMode[provider.id];

  return (
    <>
      <label className="flex items-center gap-2 text-[11px] text-foreground-muted">
        Permission mode
        <select
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
      </label>
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
    </>
  );
}
