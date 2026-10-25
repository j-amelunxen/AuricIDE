'use client';

import type { SupervisorPolicy } from '@/lib/config/supervisorPolicy';
import type { ModelOption, ProviderInfo } from '@/lib/tauri/providers';
import { supervisorProvidersOf } from '@/lib/config/supervisorProviders';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { SettingsGroup, SettingsRow } from '@/app/components/ui/settings/SettingsGroup';
import { SettingsSwitch } from '@/app/components/ui/settings/SettingsSwitch';
import { modelSizeLabel } from '@/lib/agents/supervisorLaunchPrompt';
import { NUMBER_CLASS, SELECT_CLASS, byModelRank } from './SupervisorProjectRow';

/**
 * A catalog can list one model id twice (two entries that resolve to the same CLI value);
 * a select offers it once, under the first entry's label.
 */
function uniqueModels(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  return models.filter((model) => !seen.has(model.value) && seen.add(model.value));
}

export interface SupervisorHeaderProps {
  draft: SupervisorPolicy;
  providers: ProviderInfo[];
  onChange: (draft: SupervisorPolicy) => void;
}

export function SupervisorHeader({ draft, providers, onChange }: SupervisorHeaderProps) {
  const candidateProviders = supervisorProvidersOf(draft);
  const primaryProvider = providers.find((p) => p.id === draft.supervisor.provider);

  const toggleProvider = (providerId: string, checked: boolean) => {
    let updated: string[];
    if (checked) {
      updated = [...new Set([...candidateProviders, providerId])];
    } else {
      if (candidateProviders.length <= 1) return;
      updated = candidateProviders.filter((id) => id !== providerId);
    }
    const nextSupervisor = { ...draft.supervisor, providers: updated };
    if (!updated.includes(nextSupervisor.provider)) {
      nextSupervisor.provider = updated[0];
    }
    onChange({
      ...draft,
      supervisor: nextSupervisor,
    });
  };

  return (
    <SettingsSection title="Supervisor" icon="account_tree">
      <SettingsGroup
        title="Providers and model"
        description="The CLIs that may run as supervisor. With more than one ticked, starting a supervisor asks which."
      >
        <div
          role="group"
          aria-label="Supervisor providers"
          className="flex flex-wrap gap-x-4 gap-y-2"
        >
          {providers.map((p) => {
            const isChecked = candidateProviders.includes(p.id);
            const isOnlyOne = isChecked && candidateProviders.length === 1;
            return (
              <label
                key={p.id}
                title={isOnlyOne ? 'At least one provider runs the supervisor' : undefined}
                className={`flex items-center gap-2 text-xs ${
                  isChecked ? 'font-medium text-foreground' : 'text-foreground-muted'
                }`}
              >
                <input
                  type="checkbox"
                  data-testid={`supervisor-provider-candidate-${p.id}`}
                  checked={isChecked}
                  disabled={isOnlyOne}
                  onChange={(e) => toggleProvider(p.id, e.target.checked)}
                  className="accent-[var(--primary)]"
                />
                {p.name}
              </label>
            );
          })}
        </div>
        <SettingsRow
          label="Model"
          htmlFor="supervisor-model"
          hint={`Of ${primaryProvider?.name ?? 'the first provider'}; smallest first.`}
        >
          <select
            id="supervisor-model"
            data-testid="supervisor-model"
            value={draft.supervisor.model ?? ''}
            onChange={(e) =>
              onChange({
                ...draft,
                supervisor: { ...draft.supervisor, model: e.target.value || null },
              })
            }
            className={SELECT_CLASS}
          >
            <option value="">Provider default</option>
            {uniqueModels(byModelRank(primaryProvider?.models ?? [])).map((model) => (
              <option key={model.value} value={model.value}>
                {model.label} · {modelSizeLabel(model.rank)}
              </option>
            ))}
          </select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Limits and browser">
        <SettingsRow
          label="Max running agents"
          htmlFor="supervisor-max-children"
          hint="Across every project, per supervisor."
        >
          <input
            id="supervisor-max-children"
            type="number"
            min={0}
            step={1}
            data-testid="supervisor-max-children"
            value={draft.maxRunningChildren}
            onChange={(e) =>
              onChange({
                ...draft,
                maxRunningChildren: Math.max(0, Math.floor(Number(e.target.value))),
              })
            }
            className={NUMBER_CLASS}
          />
        </SettingsRow>
        <SettingsRow
          label="Claude in Chrome"
          htmlFor="supervisor-chrome"
          hint="Applies to Claude Code; uses your own browser."
        >
          <SettingsSwitch
            id="supervisor-chrome"
            testId="supervisor-chrome"
            checked={draft.supervisor.chrome}
            onChange={(chrome) =>
              onChange({ ...draft, supervisor: { ...draft.supervisor, chrome } })
            }
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
