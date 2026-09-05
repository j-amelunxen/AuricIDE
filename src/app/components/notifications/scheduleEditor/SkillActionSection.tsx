'use client';

import type { SkillLaunchPins } from '@/lib/agents/skillLaunch';
import type { NotificationLaunch } from '@/lib/notifications/types';
import type { QuickAccessSkill } from '@/lib/store/starredProjectsSlice';
import type { PermissionMode } from '@/lib/tauri/agents';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { SCOPE_ORDER } from './helpers';
import { DISCOVERED_PREFIX, type RunSkillAction } from './types';
import { Choice, INPUT, SUBLABEL } from './ui';

export interface SkillActionSectionProps {
  snapshot?: RunSkillAction;
  skillLaunch: NotificationLaunch;
  noQuickAccess: boolean;
  orphanSkill?: RunSkillAction;
  pins: QuickAccessSkill[];
  unpinnedDiscovered: ProjectSkill[];
  providers: ProviderInfo[];
  skillStale?: boolean;
  onSelectSkill: (value: string) => void;
  onChooseSkillProvider: (providerId: string) => void;
  onSetSkillPins: (patch: SkillLaunchPins) => void;
  onSetSkillLaunch: (launch: NotificationLaunch) => void;
  onSetSkillHeadless: (headless: boolean) => void;
  onRefreshSkillSnapshot: () => void;
}

export function SkillActionSection({
  snapshot,
  skillLaunch,
  noQuickAccess,
  orphanSkill,
  pins,
  unpinnedDiscovered,
  providers,
  skillStale,
  onSelectSkill,
  onChooseSkillProvider,
  onSetSkillPins,
  onSetSkillLaunch,
  onSetSkillHeadless,
  onRefreshSkillSnapshot,
}: SkillActionSectionProps) {
  const skillProvider = snapshot?.providerId
    ? providers.find((provider) => provider.id === snapshot.providerId)
    : undefined;

  return (
    <div className="mt-2">
      {noQuickAccess && (
        <p className="mb-1 text-[9px] text-foreground-muted/60">
          No Quick Access is set up for this project. Add a skill there first.
        </p>
      )}
      <select
        data-testid="schedule-skill-select"
        value={snapshot?.skillId ?? ''}
        onChange={(event) => onSelectSkill(event.target.value)}
        className={INPUT}
      >
        <option value="">Choose a skill</option>
        {orphanSkill && (
          <option value={orphanSkill.skillId}>{orphanSkill.skillLabel} (saved)</option>
        )}
        {pins.map((pin) => (
          <option key={pin.id} value={pin.id}>
            {pin.label}
          </option>
        ))}
        {SCOPE_ORDER.map(({ scope, title }) => {
          const entries = unpinnedDiscovered.filter((skill) => skill.scope === scope);
          if (entries.length === 0) return null;
          return (
            <optgroup key={scope} label={title}>
              {entries.map((skill) => (
                <option key={skill.invocation} value={`${DISCOVERED_PREFIX}${skill.invocation}`}>
                  {skill.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      {snapshot && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className={SUBLABEL}>Agent</span>
              <select
                data-testid="schedule-skill-provider"
                value={snapshot.providerId ?? ''}
                onChange={(event) => onChooseSkillProvider(event.target.value)}
                className={INPUT}
              >
                <option value="">Default agent</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={SUBLABEL}>Model</span>
              <select
                data-testid="schedule-skill-model"
                disabled={skillProvider === undefined}
                value={snapshot.model ?? ''}
                onChange={(event) => onSetSkillPins({ model: event.target.value || undefined })}
                className={`${INPUT} disabled:opacity-40`}
              >
                <option value="">{skillProvider?.defaultModel ?? 'Pick an agent first'}</option>
                {(skillProvider?.models ?? []).map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="mt-2 block">
            <span className={SUBLABEL}>Permission</span>
            <select
              data-testid="schedule-skill-permission"
              disabled={skillProvider === undefined}
              value={snapshot.permissionMode ?? ''}
              onChange={(event) =>
                onSetSkillPins({
                  permissionMode: (event.target.value || undefined) as PermissionMode,
                })
              }
              className={`${INPUT} disabled:opacity-40`}
            >
              <option value="">Agent default</option>
              {(skillProvider?.permissionModes ?? []).map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[9px] text-foreground-muted/60">
              Starts from what the skill is pinned to. Changing it here changes this reminder only.
            </p>
          </label>

          <fieldset className="mt-2">
            <legend className={SUBLABEL}>Launch</legend>
            <div className="flex flex-col gap-1">
              <Choice
                name="schedule-skill-launch"
                testId="schedule-skill-launch-auto"
                label="Start by itself"
                checked={skillLaunch === 'auto'}
                onSelect={() => onSetSkillLaunch('auto')}
              />
              <Choice
                name="schedule-skill-launch"
                testId="schedule-skill-launch-direct"
                label="Start on click"
                checked={skillLaunch === 'direct'}
                onSelect={() => onSetSkillLaunch('direct')}
              />
              <Choice
                name="schedule-skill-launch"
                testId="schedule-skill-launch-dialog"
                label="Open the dialog first"
                checked={skillLaunch === 'dialog'}
                onSelect={() => onSetSkillLaunch('dialog')}
              />
            </div>
            {skillLaunch === 'auto' && (
              <p
                data-testid="schedule-skill-auto-hint"
                className="mt-1 text-[9px] text-foreground-muted/60"
              >
                Runs in the named folder even while you are working. Does not switch project or
                steal the terminal.
              </p>
            )}
          </fieldset>

          <label className="mt-2 flex items-start gap-2 text-[11px] text-foreground">
            <input
              type="checkbox"
              data-testid="schedule-skill-headless"
              checked={snapshot.headless === true}
              onChange={(event) => onSetSkillHeadless(event.target.checked)}
              className="mt-[2px]"
            />
            <span>
              Headless
              <span className="mt-0.5 block text-[9px] text-foreground-muted/60">
                Runs unattended and exits when the work is done. You get a notification when it
                finishes.
              </span>
            </span>
          </label>
        </>
      )}
      {skillStale && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p data-testid="schedule-snapshot-stale" className="text-[9px] text-[#ffce2e]">
            The pinned skill has changed.
          </p>
          <button
            type="button"
            data-testid="schedule-snapshot-refresh"
            onClick={onRefreshSkillSnapshot}
            className="rounded-lg px-2 py-1 text-[10px] font-semibold text-primary-light hover:bg-white/10"
          >
            Update snapshot
          </button>
        </div>
      )}
    </div>
  );
}
