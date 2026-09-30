'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { agentUsageReprice } from '@/lib/tauri/agentUsage';
import { describeReprice } from '@/lib/pm/usage/repriceSummary';

/**
 * Repairs for the open project's stored data. Each action works on this
 * project only and says what it did, run by run.
 */
export function MaintenanceContent() {
  const rootPath = useStore((s) => s.rootPath);
  const loadAgentUsage = useStore((s) => s.loadAgentUsage);
  const showToast = useStore((s) => s.showToast);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);

  if (!rootPath) {
    return (
      <div className="space-y-8">
        <SettingsSection title="Maintenance" icon="auto_fix_high">
          <p className="text-xs text-foreground-muted leading-relaxed">
            Open a project to repair its stored data.
          </p>
        </SettingsSection>
      </div>
    );
  }

  const recalculate = async () => {
    setRunning(true);
    setResult(null);
    try {
      const report = await agentUsageReprice(rootPath);
      setResult(describeReprice(report));
      // The Costs views read the slice; reloading merges the new prices in.
      if (report.repriced > 0) await loadAgentUsage(rootPath);
    } catch {
      showToast('Could not recalculate pricing', 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection title="Agent run pricing" icon="receipt_long">
        <p className="text-xs text-foreground-muted leading-relaxed">
          A run is priced when it ends. If its model was not on the price list yet, the run is
          stored without a price, and adding the model later does not change that. This reads those
          runs again and prices them with the current list. Tokens stay as they were booked, and
          runs that already have a price are not touched.
        </p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="reprice-runs"
            onClick={() => void recalculate()}
            disabled={running}
            className="rounded border border-border-dark bg-editor-bg px-2 py-1.5 text-xs text-foreground hover:border-primary disabled:opacity-40"
          >
            {running ? 'Recalculating…' : 'Recalculate pricing'}
          </button>
        </div>

        {result && (
          <div data-testid="reprice-result" role="status" className="space-y-1">
            {result.map((line) => (
              <p key={line} className="text-xs text-foreground leading-relaxed">
                {line}
              </p>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
