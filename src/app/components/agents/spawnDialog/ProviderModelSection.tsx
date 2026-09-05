import { InfoTooltip } from '@/app/components/ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';
import type { ProviderInfo } from '@/lib/tauri/providers';
import type { PermissionMode } from '@/lib/tauri/agents';
import type { PmGoal } from '@/lib/tauri/goals';
import { SelectChevron } from './SelectChevron';

interface ProviderModelSectionProps {
  goals: PmGoal[];
  goalId: string;
  onGoalIdChange: (next: string) => void;
  providers: ProviderInfo[];
  selectedProviderId: string;
  onProviderChange: (next: string) => void;
  noProviderPermitted: boolean;
  currentProvider: ProviderInfo;
  model: string;
  onModelChange: (next: string) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (next: PermissionMode) => void;
  headless: boolean;
  onHeadlessChange: (next: boolean) => void;
}

export function ProviderModelSection({
  goals,
  goalId,
  onGoalIdChange,
  providers,
  selectedProviderId,
  onProviderChange,
  noProviderPermitted,
  currentProvider,
  model,
  onModelChange,
  permissionMode,
  onPermissionModeChange,
  headless,
  onHeadlessChange,
}: ProviderModelSectionProps) {
  return (
    <>
      {goals.length > 0 && (
        <div className="space-y-1.5">
          <label
            htmlFor="goal-select"
            className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
          >
            For goal
          </label>
          <div className="relative">
            <select
              id="goal-select"
              data-testid="spawn-goal-select"
              value={goalId}
              onChange={(e) => onGoalIdChange(e.target.value)}
              className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
            >
              <option value="">None</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <SelectChevron />
          </div>
        </div>
      )}

      {providers.length > 1 && (
        <div className="space-y-1.5">
          <label
            htmlFor="provider-select"
            className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
          >
            Provider
            <InfoTooltip description={GUIDANCE.agents.provider} label="i" />
          </label>
          <div className="relative">
            <select
              id="provider-select"
              value={selectedProviderId}
              onChange={(e) => onProviderChange(e.target.value)}
              className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <SelectChevron />
          </div>
        </div>
      )}

      {noProviderPermitted && (
        <p role="alert" className="text-[11px] text-red-400">
          This project permits no agent provider. Change its provider policy under Settings →
          Project → Providers.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label
            htmlFor="model-select"
            className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
          >
            Model
            <InfoTooltip description={GUIDANCE.agents.model} label="i" />
          </label>
          <div className="relative">
            <select
              id="model-select"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
            >
              {currentProvider.models.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <SelectChevron />
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="permission-mode"
            className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
          >
            Permission Mode
            <InfoTooltip description={GUIDANCE.agents.permissionMode} label="i" />
          </label>
          <div className="relative">
            <select
              id="permission-mode"
              value={permissionMode}
              onChange={(e) => onPermissionModeChange(e.target.value as PermissionMode)}
              className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
            >
              {currentProvider.permissionModes.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.value === 'yolo' ? 'Act without asking' : opt.label}
                </option>
              ))}
            </select>
            <SelectChevron />
          </div>
        </div>
      </div>

      <p className="text-[10px] text-foreground-muted -mt-2">
        {currentProvider.permissionModes.find((o) => o.value === permissionMode)?.description}
      </p>

      <label className="flex items-center gap-2 cursor-pointer -mt-1">
        <input
          type="checkbox"
          checked={headless}
          onChange={(e) => onHeadlessChange(e.target.checked)}
          className="accent-primary h-3.5 w-3.5"
        />
        <span className="flex items-center text-xs text-foreground-muted">
          Headless Mode
          <InfoTooltip description={GUIDANCE.agents.headless} label="i" />
          <span className="text-[10px] ml-1 opacity-60">
            Runs unattended, exits when done, notifies you
          </span>
        </span>
      </label>
    </>
  );
}
