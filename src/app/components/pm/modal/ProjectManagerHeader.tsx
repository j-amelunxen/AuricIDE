'use client';

import { PersistChip } from '@/app/components/ui/PersistChip';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export interface ProjectManagerHeaderProps {
  embedded: boolean;
  pmDirty: boolean;
  viewMode: 'list' | 'tree' | 'metrics';
  onViewModeChange: (mode: 'list' | 'tree' | 'metrics') => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  onImportSpec: () => void;
  onArchiveDone: () => void;
  onClose: () => void;
  onSave: () => void;
  onSaveAndClose: () => void;
}

export function ProjectManagerHeader({
  embedded,
  pmDirty,
  viewMode,
  onViewModeChange,
  showArchived,
  onToggleArchived,
  onImportSpec,
  onArchiveDone,
  onClose,
  onSave,
  onSaveAndClose,
}: ProjectManagerHeaderProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-white/[0.015] px-5 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <AuricIcon name="checklist" className="text-[15px] text-primary-light/40 select-none" />
        <h2
          id="project-manager-title"
          className="text-sm font-semibold text-foreground tracking-tight"
        >
          {embedded ? 'Tickets' : 'Project Management'}
        </h2>
        <PersistChip dirty={pmDirty} />

        <div className="h-4 w-px bg-white/10 mx-2" />
        <div className="flex bg-white/5 rounded-md p-0.5">
          <button
            onClick={() => onViewModeChange('list')}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
              viewMode === 'list'
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            Table
          </button>
          <button
            onClick={() => onViewModeChange('tree')}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
              viewMode === 'tree'
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            Tree
          </button>
          <button
            onClick={() => onViewModeChange('metrics')}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
              viewMode === 'metrics'
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            Metrics
          </button>
        </div>

        <div className="h-4 w-px bg-white/10 mx-2" />
        <button
          onClick={onToggleArchived}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
            showArchived
              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
              : 'bg-white/5 text-foreground-muted border border-white/10 hover:bg-white/10 hover:text-foreground'
          }`}
        >
          <AuricIcon name={showArchived ? 'inventory_2' : 'archive'} className="text-[14px]" />
          {showArchived ? 'Archive View' : 'Archive'}
        </button>

        <div className="h-4 w-px bg-white/10 mx-2" />
        <button
          onClick={onImportSpec}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-white/5 text-foreground-muted border border-white/10 hover:bg-white/10 hover:text-foreground transition-all"
        >
          <AuricIcon name="description" className="text-[14px]" />
          Import Spec
        </button>

        {!showArchived && (
          <button
            onClick={onArchiveDone}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all bg-white/5 text-foreground-muted border border-white/10 hover:bg-white/10 hover:text-foreground"
            title="Move all 'Done' tickets to Archive"
          >
            <AuricIcon name="archive" className="text-[14px]" />
            Move Done to Archive
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {!embedded && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-foreground-muted hover:bg-white/5 transition-colors"
          >
            Close
          </button>
        )}
        <button
          type="button"
          disabled={!pmDirty}
          onClick={onSave}
          className="rounded-lg bg-white/5 border border-white/10 px-4 py-1.5 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
        >
          Save
        </button>
        {!embedded && (
          <button
            type="button"
            disabled={!pmDirty}
            onClick={onSaveAndClose}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-25 disabled:cursor-not-allowed hover:bg-primary/80 transition-all"
          >
            Save and Close
          </button>
        )}
      </div>
    </div>
  );
}
