'use client';

import { useState } from 'react';
import { isClosedTicketStatus } from '@/lib/pm/enums';
import { useStore } from '@/lib/store';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { getStaleRequirements, getUnverifiedRequirements } from '@/lib/store/requirementsSlice';
import { useConductorController } from '@/lib/hooks/useConductorController';
import { ConductorPanel } from '../goals/ConductorPanel';
import { ProjectSwitcher } from './ProjectSwitcher';
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
      className="group flex w-full flex-col items-center gap-2 rounded-2xl border border-white/5 bg-white/[0.03] px-5 py-5 transition-[background-color,border-color,box-shadow] duration-150 hover:border-primary/30 hover:bg-primary/5 hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.12)] active:scale-[0.98] sm:w-40"
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
      className="hidden text-lg text-foreground-muted/40 sm:block"
    />
  );
}

function specShortPath(path: string): string {
  const match = path.match(/(?:^|\/)(specs\/.*)$/i);
  return match?.[1] ?? path.split('/').pop() ?? path;
}

function SpecPicker({
  specPaths,
  onPick,
  onCreate,
  onDismiss,
}: {
  specPaths: string[];
  onPick: (path: string) => void;
  onCreate: () => void;
  onDismiss: () => void;
}) {
  useOverlayLayer({
    id: 'spec-picker',
    kind: 'tool',
    active: true,
    onEscape: onDismiss,
  });

  return (
    <>
      <button
        type="button"
        aria-label="Dismiss spec picker"
        className="fixed inset-0 z-[var(--z-tool)] cursor-default"
        onClick={onDismiss}
      />
      <div
        role="listbox"
        aria-label="Choose a spec"
        data-testid="mc-spec-picker"
        className="absolute left-0 top-full z-[var(--z-tool-nested)] mt-2 max-h-64 w-64 overflow-y-auto rounded-xl border border-white/10 bg-[#0a0a10] p-2 shadow-2xl"
      >
        {specPaths.map((path) => {
          const name = path.split('/').pop() ?? path;
          const shortPath = specShortPath(path);
          return (
            <button
              key={path}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => onPick(path)}
              className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/5"
            >
              <span className="text-xs font-medium text-foreground">{name}</span>
              <span className="text-[10px] text-foreground-muted">{shortPath}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onCreate}
          className="mt-1 w-full rounded-lg px-3 py-1.5 text-left text-[11px] text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
        >
          New spec
        </button>
      </div>
    </>
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
  /** Opens the Agents panel (Execute station when agents are running). */
  onOpenAgents?: () => void;
  /** Switches to another (starred) project by path. */
  onSwitchProject?: (path: string) => void;
  /** Leaves the open project and returns to the start screen. */
  onCloseProject?: () => void;
}

export function MissionControl({
  onCreateSpec,
  onOpenAgents,
  onSwitchProject,
  onCloseProject,
}: MissionControlProps) {
  const rootPath = useStore((s) => s.rootPath);
  const allFilePaths = useStore((s) => s.allFilePaths);
  const tickets = useStore((s) => s.pmDraftTickets);
  const requirements = useStore((s) => s.requirementsDraft);
  const agents = useStore((s) => s.agents);
  const goals = useStore((s) => s.goalsDraft);

  const openWorkPlace = useStore((s) => s.openWorkPlace);
  const closeWorkPlace = useStore((s) => s.closeWorkPlace);
  const loadPmData = useStore((s) => s.loadPmData);
  const loadRequirements = useStore((s) => s.loadRequirements);
  const selectFile = useStore((s) => s.selectFile);
  const openTab = useStore((s) => s.openTab);
  const setImportSpecDialogOpen = useStore((s) => s.setImportSpecDialogOpen);
  const setVideoImportDialogOpen = useStore((s) => s.setVideoImportDialogOpen);
  const setExcalidrawBrowserOpen = useStore((s) => s.setExcalidrawBrowserOpen);

  const conductor = useConductorController();
  const [specPickerOpen, setSpecPickerOpen] = useState(false);

  // "Spec" means documents under a specs/ directory — README, changelogs and
  // scattered notes don't count as specification.
  const specPaths = allFilePaths.filter((p) =>
    /(^|\/)specs\/.*\.(md|markdown|excalidraw)$/i.test(p)
  );
  const specDocs = specPaths.length;
  const openTickets = tickets.filter((t) => !isClosedTicketStatus(t.status)).length;
  const runningAgents = agents.filter((a) => a.status === 'running').length;

  const relevantTruths = requirements.filter(
    (r) => r.status === 'active' || r.status === 'implemented' || r.status === 'verified'
  );
  const needProof =
    getStaleRequirements(relevantTruths, STALE_DAYS).length +
    getUnverifiedRequirements(relevantTruths).length;
  const heldTruths = relevantTruths.length - needProof;

  const projectName = rootPath?.split('/').pop() ?? '';
  const firstRun = goals.length === 0;

  const openTicketsPlace = () => {
    openWorkPlace('tickets');
    if (rootPath) void loadPmData(rootPath);
  };
  const openTruths = () => {
    openWorkPlace('requirements');
    if (rootPath) void loadRequirements(rootPath);
  };
  const openSpecFile = (path: string) => {
    setSpecPickerOpen(false);
    closeWorkPlace();
    selectFile(path);
    openTab({ id: path, path, name: path.split('/').pop() ?? path });
  };

  const openSpecStation = () => {
    if (specPaths.length === 0) {
      onCreateSpec?.();
      return;
    }
    if (specPaths.length === 1) {
      openSpecFile(specPaths[0]);
      return;
    }
    setSpecPickerOpen(true);
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
        <button
          type="button"
          data-testid="mc-leave-project"
          onClick={() => onCloseProject?.()}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[11px] text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
        >
          <AuricIcon name="arrow_back" aria-hidden="true" className="text-sm" />
          Leave project
        </button>
      </div>

      {/* The loop */}
      <div className="relative grid w-full max-w-2xl grid-cols-1 gap-3 sm:flex sm:items-center sm:justify-center md:grid-cols-2">
        <Station
          id="spec"
          icon="description"
          label="Spec"
          value={String(specDocs)}
          hint="Specs under specs/"
          onClick={openSpecStation}
        />
        {specPickerOpen && (
          <SpecPicker
            specPaths={specPaths}
            onPick={openSpecFile}
            onCreate={() => {
              setSpecPickerOpen(false);
              onCreateSpec?.();
            }}
            onDismiss={() => setSpecPickerOpen(false)}
          />
        )}
        <StationArrow />
        <Station
          id="plan"
          icon="task_alt"
          label="Plan"
          value={String(openTickets)}
          hint="Open tickets"
          onClick={openTicketsPlace}
        />
        <StationArrow />
        <Station
          id="execute"
          icon="smart_toy"
          label="Execute"
          value={String(runningAgents)}
          hint="Running agents"
          onClick={() => onOpenAgents?.()}
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
        <section
          aria-labelledby="mission-control-start-heading"
          className="flex max-w-2xl flex-col items-center gap-4 text-center"
        >
          <div>
            <h2
              id="mission-control-start-heading"
              className="font-display text-lg font-bold text-foreground"
            >
              Start with an outcome
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-foreground-muted">
              AuricIDE turns an outcome into verified work: define what success looks like, add the
              work that gets you there, then let the conductor coordinate execution and proof.
            </p>
          </div>
          <ol className="grid w-full gap-3 text-left sm:grid-cols-3">
            <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-foreground-muted">
              <span className="font-bold text-primary-light">1</span>{' '}
              <span className="font-semibold text-foreground">Define an outcome or goal</span>
            </li>
            <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-foreground-muted">
              <span className="font-bold text-primary-light">2</span>{' '}
              <span className="font-semibold text-foreground">
                Add work from a spec or process video
              </span>
            </li>
            <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-foreground-muted">
              <span className="font-bold text-primary-light">3</span>{' '}
              <span className="font-semibold text-foreground">
                Let the conductor execute and verify
              </span>
            </li>
          </ol>
          <div className="flex w-full flex-wrap items-center justify-center gap-3">
            <button
              data-testid="mc-new-goal"
              onClick={() => openWorkPlace('goals')}
              className="order-first min-w-36 rounded-xl bg-primary px-6 py-2.5 text-xs font-bold text-primary-foreground transition-[background-color,box-shadow] duration-150 hover:bg-primary/90 hover:shadow-[0_0_25px_rgba(var(--primary-rgb),0.2)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
            >
              Open Goals
            </button>
            <button
              data-testid="mc-import-spec"
              onClick={() => setImportSpecDialogOpen(true)}
              className="min-w-36 rounded-xl border border-primary/20 bg-primary/10 px-6 py-2.5 text-xs font-bold text-primary-light transition-[background-color,box-shadow] duration-150 hover:bg-primary/20 hover:shadow-[0_0_25px_rgba(var(--primary-rgb),0.2)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
            >
              Import Spec
            </button>
            <button
              data-testid="mc-import-video"
              onClick={() => setVideoImportDialogOpen(true)}
              className="flex min-w-36 items-center justify-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-xs font-bold text-foreground transition-[background-color,border-color] duration-150 hover:border-white/20 hover:bg-white/5 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
            >
              <AuricIcon name="video_file" aria-hidden="true" className="text-sm" />
              Import Video
            </button>
          </div>
        </section>
      )}

      {/* The conductor, on the table — not in a drawer */}
      <div className="glass-card w-full max-w-3xl overflow-hidden rounded-2xl">
        <ConductorPanel {...conductor} />
      </div>

      {/* One surface for "take me elsewhere": starred workspaces up front,
          recents a tab away — starring happens over there, so it is not a hunt. */}
      <ProjectSwitcher currentPath={rootPath} onOpenProject={onSwitchProject} />
    </div>
  );
}
