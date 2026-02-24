'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { CoverageModal } from './CoverageModal';
import { CoverageHeatmapModal } from './CoverageHeatmapModal';

export function QAPanel() {
  const {
    coverageStatus,
    coverageSummary,
    fileCoverage,
    rootPath,
    loadCoverage,
    setSpawnDialogOpen,
    setInitialAgentTask,
  } = useStore();

  const [modalOpen, setModalOpen] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(false);

  useEffect(() => {
    if (rootPath && coverageStatus === 'idle' && !coverageSummary) {
      loadCoverage(rootPath);
    }
  }, [rootPath, coverageStatus, coverageSummary, loadCoverage]);

  const handleSetupCoverage = () => {
    setInitialAgentTask(
      'Ich möchte Coverage-Informationen in diesem Projekt aufsetzen. Bitte prüfe die vorhandene Test-Infrastruktur (z.B. Vitest) und konfiguriere Coverage-Reporting (z.B. mit v8 oder istanbul).'
    );
    setSpawnDialogOpen(true);
  };

  const handleConfigureCoverageLocation = () => {
    setInitialAgentTask(
      'Bitte suche im Projekt nach vorhandenen coverage-Ausgabedateien (z.B. coverage-summary.json, coverage-final.json, lcov.info) und teile mir den genauen relativen Pfad mit, damit ich ihn als Coverage-Quelle konfigurieren kann.'
    );
    setSpawnDialogOpen(true);
  };

  if (coverageStatus === 'loading') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
        <p className="text-sm text-foreground-muted">Loading coverage data...</p>
      </div>
    );
  }

  if (coverageStatus === 'not-found' || coverageStatus === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <span className="material-symbols-outlined mb-4 text-4xl text-foreground-muted opacity-50">
          analytics
        </span>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-foreground">
          No coverage information available
        </h3>
        <p className="mb-6 max-w-xs text-xs text-foreground-muted leading-relaxed">
          We couldn&apos;t find any coverage reports. Would you like to set up coverage for this
          project?
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleSetupCoverage}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white transition-all hover:bg-primary-light hover:shadow-[0_0_15px_rgba(188,19,254,0.4)]"
          >
            Setup Coverage
          </button>
          <button
            onClick={handleConfigureCoverageLocation}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-foreground-muted transition-all hover:border-white/20 hover:bg-white/10 hover:text-foreground"
          >
            Configure Coverage Location
          </button>
        </div>
      </div>
    );
  }

  if (!coverageSummary) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-foreground-muted">
        <p className="text-xs">Select a project to see coverage data.</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col bg-panel-bg">
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-white/5 bg-white/2 p-3">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
            Coverage Overview
          </h2>
          <button
            onClick={() => rootPath && loadCoverage(rootPath)}
            className="rounded p-0.5 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
            title="Refresh coverage data"
          >
            <span className="material-symbols-outlined text-[14px]">refresh</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {/* Summary Cards */}
          <div className="mb-5 grid grid-cols-2 gap-3">
            <CoverageCard label="Lines" value={coverageSummary.lines} />
            <CoverageCard label="Statements" value={coverageSummary.statements} />
            <CoverageCard label="Functions" value={coverageSummary.functions} />
            <CoverageCard label="Branches" value={coverageSummary.branches} />
          </div>

          {/* File count + open modal */}
          <div className="flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/2 p-4 text-center">
            <div className="flex items-center gap-2 text-foreground-muted">
              <span className="material-symbols-outlined text-[16px]">description</span>
              <span className="text-xs">
                <span className="font-bold text-foreground">{fileCoverage.length}</span> files
                tracked
              </span>
            </div>
            <button
              onClick={() => setModalOpen(true)}
              className="w-full rounded-lg bg-primary/15 px-4 py-2 text-xs font-bold text-primary transition-all hover:bg-primary/25 hover:shadow-[0_0_12px_rgba(188,19,254,0.25)]"
            >
              View Full Report
            </button>
            <button
              onClick={() => setHeatmapOpen(true)}
              className="w-full mt-2 rounded-lg border border-primary/30 bg-black/20 px-4 py-2 text-xs font-bold text-primary-light transition-all hover:border-primary/50 hover:bg-primary/10 hover:shadow-[0_0_15px_rgba(188,19,254,0.2)] flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[14px]">3d_rotation</span>
              Show 3D Heatmap
            </button>
          </div>
        </div>
      </div>

      <CoverageModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        summary={coverageSummary}
        files={fileCoverage}
      />

      <CoverageHeatmapModal
        isOpen={heatmapOpen}
        onClose={() => setHeatmapOpen(false)}
        summary={coverageSummary}
        files={fileCoverage}
      />
    </>
  );
}

function CoverageCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/2 p-3 text-center transition-all hover:border-primary/20 hover:bg-primary/5">
      <div className={`text-xl font-black tracking-tight ${getCoverageColor(value)}`}>
        {Math.round(value)}%
      </div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-foreground-muted opacity-60">
        {label}
      </div>
    </div>
  );
}

function getCoverageColor(pct: number) {
  if (pct >= 80) return 'text-emerald-400';
  if (pct >= 50) return 'text-amber-400';
  return 'text-rose-400';
}
