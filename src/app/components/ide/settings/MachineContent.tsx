'use client';

import { useCallback, useEffect, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { dependencyView, neededBy, type DependencyState } from '@/lib/machine/dependencyView';
import { useStore } from '@/lib/store';
import { copyToClipboard } from '@/lib/tauri/clipboard';
import { machineDependencies, type DependencyReport } from '@/lib/tauri/machine';

const STATE_STYLE: Record<DependencyState, { icon: string; tone: string; word: string }> = {
  found: { icon: 'check_circle', tone: 'text-emerald-400', word: 'Found' },
  'outside-path': { icon: 'check_circle', tone: 'text-emerald-400', word: 'Found outside PATH' },
  missing: { icon: 'info', tone: 'text-foreground-muted', word: 'Not installed' },
  problem: { icon: 'warning', tone: 'text-amber-400', word: 'Needs attention' },
};

function DependencyRow({
  report,
  onCopy,
}: {
  report: DependencyReport;
  onCopy: (report: DependencyReport) => void;
}) {
  const view = dependencyView(report);
  const style = STATE_STYLE[view.state];
  const usedBy = neededBy(report.features);
  return (
    <li data-testid={`machine-dependency-${report.id}`} data-state={view.state} className="py-3">
      <div className="flex items-start gap-2.5">
        <AuricIcon
          name={style.icon}
          aria-hidden="true"
          className={`mt-px shrink-0 text-[14px] ${style.tone}`}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs font-semibold text-foreground">{report.label}</span>
            <span
              className={`text-[10px] ${view.state === 'problem' ? 'text-amber-300' : 'text-foreground-muted'}`}
            >
              {style.word}
            </span>
            {view.version && (
              <span className="font-mono text-[10px] text-foreground-muted">{view.version}</span>
            )}
          </p>
          {view.path && (
            <p
              className="truncate font-mono text-[10px] text-foreground-muted/80"
              title={view.path}
            >
              {view.path}
            </p>
          )}
          <p className="text-[10px] leading-relaxed text-foreground-muted">
            {view.state !== 'found' && view.state !== 'outside-path' && `${report.detail} `}
            Required: {report.requirement}.{usedBy ? ` Needed by ${usedBy}.` : ''}
          </p>
          {report.fix && (
            <div className="flex items-center gap-1.5 pt-0.5">
              <code className="min-w-0 select-all truncate rounded border border-white/5 bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted">
                {report.fix}
              </code>
              <button
                type="button"
                onClick={() => onCopy(report)}
                aria-label={`Copy command for ${report.label}`}
                title="Copy command"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <AuricIcon name="content_copy" aria-hidden="true" className="text-[13px]" />
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Settings → Machine: the tools features need from this computer, one line
 * each. Read-only apart from Copy and Check Again. AuricIDE does not install
 * or pin them; it says what is missing and the one command that fixes it.
 */
export function MachineContent() {
  const showToast = useStore((s) => s.showToast);
  const [reports, setReports] = useState<DependencyReport[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (refresh: boolean) => {
    setChecking(true);
    try {
      setReports(await machineDependencies({ refresh }));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    machineDependencies().then(
      (found) => current && setReports(found),
      () => current && setFailed(true)
    );
    return () => {
      current = false;
    };
  }, []);

  const copy = async (report: DependencyReport) => {
    if (!report.fix) return;
    const copied = await copyToClipboard(report.fix);
    showToast(
      copied ? `Copied the command for ${report.label}` : 'Could not copy the command',
      copied ? 'info' : 'error'
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-xs leading-relaxed text-foreground-muted">
        Some features rely on tools that come from this computer. AuricIDE checks them, tells you
        what is missing and the command that fixes it, and installs nothing itself.
      </p>

      <SettingsSection title="Tools" icon="memory">
        <div className="flex items-center justify-between gap-4">
          <p aria-live="polite" className="text-[10px] text-foreground-muted">
            {checking
              ? 'Checking…'
              : 'Installed something? Check again, even if it changed your shell setup.'}
          </p>
          <button
            type="button"
            onClick={() => void check(true)}
            disabled={checking}
            title={checking ? 'Checking…' : undefined}
            className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold text-foreground transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Check Again
          </button>
        </div>

        {failed && (
          <p role="alert" className="text-[11px] text-amber-300">
            Could not check this machine.
          </p>
        )}
        {reports === null && !failed && (
          <p className="text-[10px] text-foreground-muted">Checking tools…</p>
        )}
        {reports && (
          <ul className="divide-y divide-white/5 rounded-lg border border-white/5 bg-black/20 px-3">
            {reports.map((report) => (
              <DependencyRow key={report.id} report={report} onCopy={(r) => void copy(r)} />
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}
