'use client';

import { comboPreview } from '@/lib/quickAccess/combo';
import type { QuickAccessCombo } from '@/lib/store/starredProjectsSlice';
import type { RunComboAction } from './types';
import { INPUT } from './ui';

export interface ComboActionSectionProps {
  snapshot?: RunComboAction;
  noQuickAccess: boolean;
  orphanCombo?: RunComboAction;
  combos: QuickAccessCombo[];
  comboStale?: boolean;
  onSelectCombo: (comboId: string) => void;
  onRefreshComboSnapshot: () => void;
}

export function ComboActionSection({
  snapshot,
  noQuickAccess,
  orphanCombo,
  combos,
  comboStale,
  onSelectCombo,
  onRefreshComboSnapshot,
}: ComboActionSectionProps) {
  return (
    <div className="mt-2">
      {noQuickAccess && (
        <p className="mb-1 text-[9px] text-foreground-muted/60">
          No Quick Access is set up for this project. Add a combo there first.
        </p>
      )}
      <select
        data-testid="schedule-combo-select"
        value={snapshot?.comboId ?? ''}
        onChange={(event) => onSelectCombo(event.target.value)}
        className={INPUT}
      >
        <option value="">Choose a combo</option>
        {orphanCombo && (
          <option value={orphanCombo.comboId}>{orphanCombo.comboLabel} (saved)</option>
        )}
        {combos.map((combo) => (
          <option key={combo.id} value={combo.id}>
            {combo.label}
          </option>
        ))}
      </select>
      {snapshot && (
        <p
          data-testid="schedule-combo-preview"
          className="mt-1 text-[9px] text-foreground-muted/60"
        >
          {comboPreview({
            id: snapshot.comboId,
            label: snapshot.comboLabel,
            steps: snapshot.steps,
          })}
        </p>
      )}
      {snapshot && (
        <p className="mt-1 text-[9px] text-foreground-muted/60">
          Starts on the click and runs the steps in order, each with the provider and permission it
          is pinned to.
        </p>
      )}
      {comboStale && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p data-testid="schedule-snapshot-stale" className="text-[9px] text-[#ffce2e]">
            The pinned combo has changed.
          </p>
          <button
            type="button"
            data-testid="schedule-snapshot-refresh"
            onClick={onRefreshComboSnapshot}
            className="rounded-lg px-2 py-1 text-[10px] font-semibold text-primary-light hover:bg-white/10"
          >
            Update snapshot
          </button>
        </div>
      )}
    </div>
  );
}
