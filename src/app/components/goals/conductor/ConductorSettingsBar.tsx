'use client';

import type { ProviderInfo } from '@/lib/tauri/providers';
import { selectCls, settingCls } from './conductorHelpers';

export interface ConductorSettingsBarProps {
  running: boolean;
  maxConcurrent: number;
  onSetMaxConcurrent: (n: number) => void;
  providerList: ProviderInfo[];
  providerId: string | null;
  onSetProvider: (id: string | null) => void;
  model: string | null;
  onSetModel: (model: string | null) => void;
  activeProvider?: ProviderInfo;
  canReview: boolean;
  requireReview: boolean;
  judgeConfigured: boolean;
  onSetRequireReview: (v: boolean) => void;
  onSetJudgeForm: (form: 'llm' | 'agent') => void;
  effectiveJudgeForm: 'llm' | 'agent';
  judgeProviderId: string | null;
  onSetJudgeProvider: (id: string | null) => void;
  judgeModel: string | null;
  onSetJudgeModel: (model: string | null) => void;
  judgeProvider?: ProviderInfo;
  judgeLlmModel: string | null;
}

export function ConductorSettingsBar({
  running,
  maxConcurrent,
  onSetMaxConcurrent,
  providerList,
  providerId,
  onSetProvider,
  model,
  onSetModel,
  activeProvider,
  canReview,
  requireReview,
  judgeConfigured,
  onSetRequireReview,
  onSetJudgeForm,
  effectiveJudgeForm,
  judgeProviderId,
  onSetJudgeProvider,
  judgeModel,
  onSetJudgeModel,
  judgeProvider,
  judgeLlmModel,
}: ConductorSettingsBarProps) {
  return (
    <div
      data-testid="conductor-settings"
      className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/5 pt-2.5"
    >
      {/* Concurrency */}
      <label className={`${settingCls} text-foreground-muted`}>
        parallel
        <input
          data-testid="conductor-max-concurrent"
          type="number"
          min={1}
          max={8}
          value={maxConcurrent}
          onChange={(e) => onSetMaxConcurrent(Number(e.target.value) || 1)}
          className="w-12 rounded bg-white/5 px-1.5 py-0.5 text-center text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary/30"
        />
      </label>

      {/* Provider + model selection (before a run starts) */}
      {!running && providerList.length > 0 && (
        <>
          <label className={`${settingCls} text-foreground-muted`}>
            Provider
            <select
              data-testid="conductor-provider-select"
              value={providerId ?? ''}
              onChange={(e) => onSetProvider(e.target.value || null)}
              className={selectCls}
            >
              <option value="">Default</option>
              {providerList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`${settingCls} text-foreground-muted`}>
            Model
            <select
              data-testid="conductor-model-select"
              value={model ?? ''}
              onChange={(e) => onSetModel(e.target.value || null)}
              className={selectCls}
            >
              <option value="">Auto (per ticket)</option>
              {activeProvider?.models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {/* Judge review */}
      {!running && (
        <label
          className={`${settingCls} ${
            canReview ? 'text-foreground-muted' : 'text-foreground-muted/40'
          }`}
          title={
            canReview
              ? 'Finished tickets pass an independent judge before counting as done.'
              : 'Needs either a Judge model (Settings → Judge) or an agent CLI to review with.'
          }
        >
          <input
            data-testid="conductor-require-review"
            type="checkbox"
            checked={requireReview && canReview}
            disabled={!canReview}
            onChange={(e) => {
              if (e.target.checked && !judgeConfigured) onSetJudgeForm('agent');
              onSetRequireReview(e.target.checked);
            }}
            className="accent-primary"
          />
          Judge review
        </label>
      )}
      {!running && requireReview && canReview && (
        <label className={`${settingCls} text-foreground-muted`}>
          via
          <select
            data-testid="conductor-judge-form"
            value={effectiveJudgeForm}
            onChange={(e) => onSetJudgeForm(e.target.value as 'llm' | 'agent')}
            className={selectCls}
          >
            <option value="llm" disabled={!judgeConfigured}>
              {judgeConfigured ? 'LLM call' : 'LLM call (no key)'}
            </option>
            <option value="agent" disabled={providerList.length === 0}>
              Review agent
            </option>
          </select>
        </label>
      )}

      {/* Which harness reviews */}
      {!running && requireReview && canReview && effectiveJudgeForm === 'agent' && (
        <>
          <label className={`${settingCls} text-foreground-muted`}>
            Judge on
            <select
              data-testid="conductor-judge-provider"
              value={judgeProviderId ?? ''}
              onChange={(e) => onSetJudgeProvider(e.target.value || null)}
              className={selectCls}
            >
              <option value="">Same as conductor</option>
              {providerList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`${settingCls} text-foreground-muted`}>
            Judge model
            <select
              data-testid="conductor-judge-model"
              value={judgeModel ?? ''}
              onChange={(e) => onSetJudgeModel(e.target.value || null)}
              className={selectCls}
            >
              <option value="">Same as conductor</option>
              {judgeProvider?.models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {!running && requireReview && canReview && effectiveJudgeForm === 'llm' && (
        <span
          data-testid="conductor-judge-llm-model"
          className={`${settingCls} text-foreground-muted/70`}
          title="Set under Settings → Application → Credentials → Judge"
        >
          on {judgeLlmModel ?? 'the Judge model from Settings'}
        </span>
      )}
    </div>
  );
}
