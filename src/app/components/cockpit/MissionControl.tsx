'use client';

import { useStore } from '@/lib/store';
import { getStaleRequirements, getUnverifiedRequirements } from '@/lib/store/requirementsSlice';
import { useConductorController } from '@/lib/hooks/useConductorController';
import { ConductorPanel } from '../goals/ConductorPanel';
import { QuickAccess } from './QuickAccess';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

const STALE_DAYS = 30;

interface StationProps {
  id: string;
  icon: string;
  label: string;
  value: string;
  hint: string;
  onClick: () => void;
}

function Station({ id, icon, label, value, hint, onClick }: StationProps) {
  return (
    <button
      data-testid={`mc-station-${id}`}
      onClick={onClick}
      title={hint}
      className="group flex w-40 flex-col items-center gap-2 rounded-2xl border border-white/5 bg-white/[0.03] px-5 py-5 transition-[background-color,border-color,box-shadow] duration-150 hover:border-primary/30 hover:bg-primary/5 hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.12)] active:scale-[0.98]"
    >
      <AuricIcon
        name={icon}
        aria-hidden="true"
        className="text-xl text-primary-light opacity-80 group-hover:opacity-100"
      />
      <span className="font-display text-2xl font-black tabular-nums text-foreground">{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
        {label}
      </span>
    </button>
  );
}

function StationArrow() {
  return (
    <AuricIcon
      name="arrow_forward"
      aria-hidden="true"
      className="text-lg text-foreground-muted/40"
    />
  );
}

/**
 * Mission Control — the home surface. Shows the supervised loop
 * (Spec → Plan → Execute → Verify) with live numbers, the conductor with its
 * full controls, and what needs the supervisor's attention. Rendered whenever
 * a project is open and no document has focus: the editor is a mode, this is
 * the cockpit.
 */
export interface MissionControlProps {
  /** Creates a new spec document under specs/ and opens it in the editor. */
  onCreateSpec?: () => void;
  /** Switches to another (starred) project by path. */
  onSwitchProject?: (path: string) => void;
}

export function MissionControl({ onCreateSpec, onSwitchProject }: MissionControlProps) {
  const rootPath = useStore((s) => s.rootPath);
  const allFilePaths = useStore((s) => s.allFilePaths);
  const tickets = useStore((s) => s.pmDraftTickets);
  const requirements = useStore((s) => s.requirementsDraft);
  const agents = useStore((s) => s.agents);
  const goals = useStore((s) => s.goalsDraft);

  const setPmModalOpen = useStore((s) => s.setPmModalOpen);
  const loadPmData = useStore((s) => s.loadPmData);
  const setRequirementsModalOpen = useStore((s) => s.setRequirementsModalOpen);
  const loadRequirements = useStore((s) => s.loadRequirements);
  const setGoalsModalOpen = useStore((s) => s.setGoalsModalOpen);
  const setImportSpecDialogOpen = useStore((s) => s.setImportSpecDialogOpen);
  const setVideoImportDialogOpen = useStore((s) => s.setVideoImportDialogOpen);
  const setExcalidrawBrowserOpen = useStore((s) => s.setExcalidrawBrowserOpen);

  const conductor = useConductorController();

  // "Spec" means documents under a specs/ directory — README, changelogs and
  // scattered notes don't count as specification.
  const specDocs = allFilePaths.filter((p) =>
    /(^|\/)specs\/.*\.(md|markdown|excalidraw)$/i.test(p)
  ).length;
  const openTickets = tickets.filter((t) => t.status !== 'done' && t.status !== 'archived').length;
  const runningAgents = agents.filter((a) => a.status === 'running').length;

  const relevantTruths = requirements.filter(
    (r) => r.status === 'active' || r.status === 'implemented' || r.status === 'verified'
  );
  const needProof =
    getStaleRequirements(relevantTruths, STALE_DAYS).length +
    getUnverifiedRequirements(relevantTruths).length;
  const heldTruths = relevantTruths.length - needProof;

  const projectName = rootPath?.split('/').pop() ?? '';
  const firstRun = tickets.length === 0 && goals.length === 0;

  const openPlan = () => {
    setPmModalOpen(true);
    if (rootPath) void loadPmData(rootPath);
  };
  const openTruths = () => {
    setRequirementsModalOpen(true);
    if (rootPath) void loadRequirements(rootPath);
  };

  return (
    <div
      data-testid="mission-control"
      className="flex h-full flex-col items-center justify-center gap-8 overflow-y-auto p-8"
    >
      <div className="text-center animate-in fade-in zoom-in duration-500">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground-muted">
          Mission Control
        </p>
        <h1 className="mt-1 font-display text-3xl font-black tracking-tight text-white">
          {projectName}
        </h1>
      </div>

      {/* The loop */}
      <div className="flex items-center gap-3">
        <Station
          id="spec"
          icon="description"
          label="Spec"
          value={String(specDocs)}
          hint="Specs under specs/"
          onClick={() => onCreateSpec?.()}
        />
        <StationArrow />
        <Station
          id="plan"
          icon="task_alt"
          label="Plan"
          value={String(openTickets)}
          hint="Open tickets"
          onClick={openPlan}
        />
        <StationArrow />
        <Station
          id="execute"
          icon="smart_toy"
          label="Execute"
          value={String(runningAgents)}
          hint="Running agents"
          onClick={() => setGoalsModalOpen(true)}
        />
        <StationArrow />
        <Station
          id="verify"
          icon="verified"
          label="Verify"
          value={relevantTruths.length > 0 ? `${heldTruths}/${relevantTruths.length}` : '-'}
          hint="Verified / total"
          onClick={openTruths}
        />
      </div>

      {/* Quiet secondary path into the spec station */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        <button
          data-testid="mc-import-video-persistent"
          onClick={() => setVideoImportDialogOpen(true)}
          className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[11px] text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
        >
          <AuricIcon name="video_file" aria-hidden="true" className="text-sm" />
          Import process video
        </button>
        <button
          data-testid="mc-excalidraw-browse"
          onClick={() => setExcalidrawBrowserOpen(true)}
          className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[11px] text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
        >
          <AuricIcon name="draw" aria-hidden="true" className="text-sm" />
          Import diagrams from Excalidraw+
        </button>
      </div>

      {needProof > 0 && (
        <button
          data-testid="mc-truths-warning"
          onClick={openTruths}
          className="flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
        >
          <AuricIcon name="warning" aria-hidden="true" className="text-sm" />
          {needProof} stale/unverified
        </button>
      )}

      {firstRun && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="max-w-sm text-xs leading-relaxed text-foreground-muted">
            Import a spec, import a video, or create a goal.
          </p>
          <div className="flex items-center gap-3">
            <button
              data-testid="mc-import-spec"
              onClick={() => setImportSpecDialogOpen(true)}
              className="rounded-xl bg-primary/10 border border-primary/20 px-6 py-2.5 text-xs font-bold text-primary-light transition-[background-color,box-shadow] duration-150 hover:bg-primary/20 hover:shadow-[0_0_25px_rgba(var(--primary-rgb),0.2)] active:scale-[0.98]"
            >
              Import Spec
            </button>
            <button
              data-testid="mc-import-video"
              onClick={() => setVideoImportDialogOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-xs font-bold text-foreground transition-[background-color,border-color] duration-150 hover:border-white/20 hover:bg-white/5 active:scale-[0.98]"
            >
              <AuricIcon name="video_file" aria-hidden="true" className="text-sm" />
              Import Video
            </button>
            <button
              data-testid="mc-new-goal"
              onClick={() => setGoalsModalOpen(true)}
              className="rounded-xl border border-white/10 px-6 py-2.5 text-xs font-bold text-foreground transition-[background-color,border-color] duration-150 hover:bg-white/5 hover:border-white/20 active:scale-[0.98]"
            >
              New Goal
            </button>
          </div>
        </div>
      )}

      {/* The conductor, on the table — not in a drawer */}
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/5">
        <ConductorPanel {...conductor} />
      </div>

      {/* Quick Access — jump between starred workspaces */}
      <QuickAccess currentPath={rootPath} onSwitchProject={onSwitchProject} />
    </div>
  );
}
