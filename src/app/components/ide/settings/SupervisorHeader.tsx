'use client';

import type { SupervisorPolicy } from '@/lib/config/supervisorPolicy';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { supervisorProvidersOf } from '@/lib/config/supervisorProviders';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { modelSizeLabel } from '@/lib/agents/supervisorLaunchPrompt';
import { NUMBER_CLASS, SELECT_CLASS, byModelRank } from './SupervisorProjectRow';

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
      <div className="space-y-4">
        <div>
          <span className="block text-xs font-medium text-foreground mb-1">
            Supervisor Candidate Providers
          </span>
          <p className="text-[11px] text-foreground-muted mb-2">
            Select which providers may run as supervisor. If more than one is selected, a choice
            dialog appears when starting a supervisor.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            {providers.map((p) => {
              const isChecked = candidateProviders.includes(p.id);
              const isOnlyOne = isChecked && candidateProviders.length === 1;
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-2 text-xs ${
                    isChecked ? 'text-foreground font-medium' : 'text-foreground-muted'
                  }`}
                >
                  <input
                    type="checkbox"
                    data-testid={`supervisor-provider-candidate-${p.id}`}
                    checked={isChecked}
                    disabled={isOnlyOne}
                    onChange={(e) => toggleProvider(p.id, e.target.checked)}
                  />
                  {p.name}
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-3 border-t border-white/5">
          <label className="flex items-center gap-2 text-xs text-foreground">
            Model
            <select
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
              {byModelRank(primaryProvider?.models ?? []).map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label} · {modelSizeLabel(model.rank)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              data-testid="supervisor-chrome"
              checked={draft.supervisor.chrome}
              onChange={(e) =>
                onChange({
                  ...draft,
                  supervisor: { ...draft.supervisor, chrome: e.target.checked },
                })
              }
            />
            Claude in Chrome
            <span className="text-[10px] text-foreground-muted">
              (applies to Claude Code; your own browser)
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs text-foreground">
            Max running agents
            <input
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
          </label>
        </div>
      </div>
    </SettingsSection>
  );
}
