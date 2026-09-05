'use client';

import type { PmGoal } from '@/lib/tauri/goals';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { clampInt } from './helpers';
import type { ConductorActionDraft } from './types';
import { Choice, INPUT, SUBLABEL } from './ui';

export interface ConductorActionSectionProps {
  draft: ConductorActionDraft;
  providers: ProviderInfo[];
  conductorGoals: PmGoal[];
  conductorGoalsLoading: boolean;
  onSetConductorDraft: (patch: Partial<ConductorActionDraft>) => void;
  onSelectConductorGoal: (goalId: string) => void;
}

export function ConductorActionSection({
  draft,
  providers,
  conductorGoals,
  conductorGoalsLoading,
  onSetConductorDraft,
  onSelectConductorGoal,
}: ConductorActionSectionProps) {
  const judgeProvider = draft.judgeProviderId
    ? providers.find((provider) => provider.id === draft.judgeProviderId)
    : undefined;

  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={SUBLABEL}>Tickets per run</span>
          <input
            data-testid="schedule-conductor-budget"
            type="number"
            min={1}
            max={50}
            value={draft.ticketBudget}
            onChange={(event) =>
              onSetConductorDraft({
                ticketBudget: clampInt(Number(event.target.value), 1, 50),
              })
            }
            className={INPUT}
          />
        </label>

        <label className="block">
          <span className={SUBLABEL}>In parallel</span>
          <input
            data-testid="schedule-conductor-concurrency"
            type="number"
            min={1}
            max={8}
            value={draft.maxConcurrent}
            onChange={(event) =>
              onSetConductorDraft({
                maxConcurrent: clampInt(Number(event.target.value), 1, 8),
              })
            }
            className={INPUT}
          />
          <p className="mt-1 text-[9px] text-foreground-muted/60">1 = one after another</p>
        </label>
      </div>

      <label className="mt-2 block">
        <span className={SUBLABEL}>Scope</span>
        <select
          data-testid="schedule-conductor-goal"
          disabled={conductorGoalsLoading}
          value={draft.goalId ?? ''}
          onChange={(event) => onSelectConductorGoal(event.target.value)}
          className={`${INPUT} disabled:opacity-40`}
        >
          <option value="">{conductorGoalsLoading ? 'Loading goals…' : 'All tickets'}</option>
          {draft.goalId !== null && !conductorGoals.some((goal) => goal.id === draft.goalId) && (
            <option value={draft.goalId}>{draft.goalName ?? draft.goalId} (saved)</option>
          )}
          {conductorGoals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.name}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-2 flex items-start gap-2 text-[11px] text-foreground">
        <input
          type="checkbox"
          data-testid="schedule-conductor-review"
          checked={draft.requireReview}
          onChange={(event) => onSetConductorDraft({ requireReview: event.target.checked })}
          className="mt-[2px]"
        />
        <span>Judge the result</span>
      </label>

      {/* The judge's own harness. Left on "the project's setting" a
          schedule keeps behaving like the panel's Start button, which
          is what every schedule saved before this did. */}
      {draft.requireReview && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block">
            <span className={SUBLABEL}>Judge via</span>
            <select
              data-testid="schedule-conductor-judge-form"
              value={draft.judgeForm ?? ''}
              onChange={(event) =>
                onSetConductorDraft({
                  judgeForm: (event.target.value || null) as 'llm' | 'agent' | null,
                  // A form that spawns nothing has no harness to name;
                  // keeping one would save a setting that never applies.
                  ...(event.target.value !== 'agent' && {
                    judgeProviderId: null,
                    judgeModel: null,
                  }),
                })
              }
              className={INPUT}
            >
              <option value="">The project&apos;s setting</option>
              <option value="llm">LLM call</option>
              <option value="agent">Review agent</option>
            </select>
          </label>

          {draft.judgeForm === 'agent' && (
            <label className="block">
              <span className={SUBLABEL}>Judge agent</span>
              <select
                data-testid="schedule-conductor-judge-provider"
                value={draft.judgeProviderId ?? ''}
                onChange={(event) =>
                  onSetConductorDraft({
                    judgeProviderId: event.target.value || null,
                    // The model belongs to the provider that offers it.
                    judgeModel: null,
                  })
                }
                className={INPUT}
              >
                <option value="">Same as the conductor</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {draft.judgeForm === 'agent' && (
            <label className="block">
              <span className={SUBLABEL}>Judge model</span>
              <select
                data-testid="schedule-conductor-judge-model"
                disabled={judgeProvider === undefined}
                value={draft.judgeModel ?? ''}
                onChange={(event) =>
                  onSetConductorDraft({ judgeModel: event.target.value || null })
                }
                className={`${INPUT} disabled:opacity-40`}
              >
                <option value="">
                  {judgeProvider === undefined ? 'Pick an agent first' : 'Same as the conductor'}
                </option>
                {(judgeProvider?.models ?? []).map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <fieldset className="mt-2">
        <legend className={SUBLABEL}>Launch</legend>
        <div className="flex flex-col gap-1">
          <Choice
            name="schedule-conductor-launch"
            testId="schedule-conductor-launch-auto"
            label="Start by itself"
            checked={draft.launch === 'auto'}
            onSelect={() => onSetConductorDraft({ launch: 'auto' })}
          />
          <Choice
            name="schedule-conductor-launch"
            testId="schedule-conductor-launch-direct"
            label="Start on click"
            checked={draft.launch === 'direct'}
            onSelect={() => onSetConductorDraft({ launch: 'direct' })}
          />
          <Choice
            name="schedule-conductor-launch"
            testId="schedule-conductor-launch-dialog"
            label="Open the panel first"
            checked={draft.launch === 'dialog'}
            onSelect={() => onSetConductorDraft({ launch: 'dialog' })}
          />
        </div>
        {draft.launch === 'auto' && (
          <p
            data-testid="schedule-conductor-auto-hint"
            className="mt-1 text-[9px] text-foreground-muted/60"
          >
            Only when the IDE is idle and the timing is fresh; otherwise it waits for your click.
          </p>
        )}
      </fieldset>
    </div>
  );
}
