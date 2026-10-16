'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { useStore } from '@/lib/store';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { FALLBACK_CRUSH_PROVIDER, listProviders, type ProviderInfo } from '@/lib/tauri/providers';
import { supervisorPolicyGet } from '@/lib/tauri/supervisorPolicy';
import { saveSupervisorPresets } from '@/lib/quickAccess/supervisorPresets';
import { useSupervisorPresets } from '@/lib/quickAccess/useSupervisorPresets';
import { useAllowedProviders } from '@/lib/hooks/useAllowedProviders';
import { listProjectSkills, type ProjectSkill } from '@/lib/tauri/projectSkills';
import { enabledSkillSources, loadSkillSources } from '@/lib/settings/skillSources';
import {
  quickAccessCombos,
  quickAccessSkills,
  quickAccessWheelSlots,
  type ProjectIconOverride,
  type QuickAccessCombo,
  type QuickAccessSkill,
  type StarredProject,
} from '@/lib/store/starredProjectsSlice';
import { launchEntries, wheelSlotId } from '@/lib/quickAccess/launchSkills';
import { normalizeWheelSlots } from '@/lib/quickAccess/wheel';
import { QuickAccessIconPicker } from './QuickAccessIconPicker';
import { QuickAccessSkillsEditor } from './QuickAccessSkillsEditor';
import { QuickAccessCombosEditor } from './QuickAccessCombosEditor';
import { QuickAccessWheelEditor } from './QuickAccessWheelEditor';
import { loadAuricSkills } from '@/lib/settings/auricSkills';
import { menuSkillEntries, pinSlottedLibrarySkills } from '@/lib/quickAccess/menuSkills';

interface QuickAccessSettingsDialogProps {
  project: StarredProject;
  onClose: () => void;
}

/** What one Quick Access tile can launch, as the dialog edits it. */
interface TilePresets {
  icon?: ProjectIconOverride;
  skills: QuickAccessSkill[];
  combos: QuickAccessCombo[];
  wheelSlots: (string | null)[];
}

/** Until the registry answers: the supervisor runs on Claude Code in this version. */
const SUPERVISOR_PROVIDER_STUB: ProviderInfo = {
  id: 'claude',
  name: 'Claude Code',
  models: [],
  permissionModes: [],
  defaultModel: '',
  defaultPermissionMode: 'default',
};

/**
 * Per-project Quick Access settings: the tile's mark, and the launch presets
 * that the radial wheel can pin to a slot.
 *
 * The panel is split out so it remounts per open and the draft always starts
 * from the persisted settings — the same shape SpawnAgentDialog uses.
 */
export function QuickAccessSettingsDialog({ project, onClose }: QuickAccessSettingsDialogProps) {
  return <ProjectSettingsPanel key={project.path} project={project} onClose={onClose} />;
}

function ProjectSettingsPanel({ project, onClose }: QuickAccessSettingsDialogProps) {
  const updateStarredProjectSettings = useStore((s) => s.updateStarredProjectSettings);
  const [discovered, setDiscovered] = useState<ProjectSkill[]>([]);
  const [discoveryReady, setDiscoveryReady] = useState(false);
  // This dialog configures a project from the launcher, which is not
  // necessarily the open one — so ask about that project's policy.
  const { providers } = useAllowedProviders(FALLBACK_CRUSH_PROVIDER, project.path);

  useEffect(() => {
    let cancelled = false;
    void listProjectSkills(project.path, enabledSkillSources(loadSkillSources())).then((found) => {
      if (cancelled) return;
      setDiscovered(found);
      setDiscoveryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [project.path]);

  return (
    <PresetsPanel
      title={`Quick Access: ${project.name}`}
      discardMessage="The edits to this project's Quick Access settings have not been saved."
      initial={{
        icon: project.icon,
        skills: quickAccessSkills(project),
        combos: quickAccessCombos(project),
        wheelSlots: quickAccessWheelSlots(project),
      }}
      iconPath={project.path}
      showCombos
      providers={providers}
      discovered={discovered}
      discoveryReady={discoveryReady}
      onSave={(saved) => updateStarredProjectSettings(project.path, saved)}
      onClose={onClose}
    />
  );
}

/**
 * The supervisor tile's skills and wheel. No icon, no combos and no skills
 * from disk: the supervisor loads none (`--restricted`), so every skill is a
 * prompt, and its provider is fixed — only the model is a choice.
 */
export function SupervisorQuickAccessDialog({ onClose }: { onClose: () => void }) {
  const presets = useSupervisorPresets();
  const [provider, setProvider] = useState<ProviderInfo>(SUPERVISOR_PROVIDER_STUB);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listProviders(), supervisorPolicyGet()])
      .then(([providers, { policy }]) => {
        const found = providers.find((p) => p.id === policy.supervisor.provider);
        if (!cancelled && found) setProvider(found);
      })
      // No backend: the stub stays, and the model list stays empty.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PresetsPanel
      title="Quick Access: Supervisor"
      discardMessage="The edits to the supervisor's Quick Access settings have not been saved."
      initial={{ skills: presets.skills, combos: [], wheelSlots: presets.wheelSlots }}
      showCombos={false}
      providers={[provider]}
      fixedProvider={provider}
      discovered={[]}
      discoveryReady
      note="The supervisor loads no skills from disk, so each skill here is a prompt. It becomes the first task of a new supervisor, or a message to the one already running."
      onSave={(saved) =>
        saveSupervisorPresets({ skills: saved.skills, wheelSlots: saved.wheelSlots })
      }
      onClose={onClose}
    />
  );
}

interface PresetsPanelProps {
  title: string;
  discardMessage: string;
  initial: TilePresets;
  /** Shows the icon picker for this folder; left out where a tile has no icon to pick. */
  iconPath?: string;
  showCombos: boolean;
  providers: ProviderInfo[];
  fixedProvider?: ProviderInfo;
  discovered: ProjectSkill[];
  discoveryReady: boolean;
  note?: string;
  onSave: (presets: TilePresets) => void;
  onClose: () => void;
}

function PresetsPanel({
  title,
  discardMessage,
  initial,
  iconPath,
  showCombos,
  providers,
  fixedProvider,
  discovered,
  discoveryReady,
  note,
  onSave,
  onClose,
}: PresetsPanelProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();

  const [icon, setIcon] = useState<ProjectIconOverride | undefined>(initial.icon);
  const [skills, setSkills] = useState<QuickAccessSkill[]>(initial.skills);
  const [combos, setCombos] = useState<QuickAccessCombo[]>(initial.combos);
  const [wheelSlots, setWheelSlots] = useState<(string | null)[]>(initial.wheelSlots);
  const [announcement, setAnnouncement] = useState('');
  const { confirm, confirmDialog } = useConfirm();
  const [auricSkills] = useState(loadAuricSkills);

  // The wheel offers the Settings → Skills library too, like the right-click
  // menu does; picking one from it pins it to this tile's skills.
  const entries = launchEntries(menuSkillEntries(skills, auricSkills), combos);
  const draftSlots = normalizeWheelSlots(wheelSlots, entries.map(wheelSlotId));
  const changeWheelSlots = (slots: (string | null)[]) => {
    setWheelSlots(slots);
    setSkills(pinSlottedLibrarySkills(skills, slots, auricSkills));
  };

  const dirty =
    JSON.stringify({ icon, skills, combos, wheelSlots: draftSlots }) !==
    JSON.stringify({
      icon: initial.icon,
      skills: initial.skills,
      combos: initial.combos,
      wheelSlots: normalizeWheelSlots(
        initial.wheelSlots,
        launchEntries(initial.skills, initial.combos).map(wheelSlotId)
      ),
    });
  const incompleteSkill = skills.some((skill) => !skill.label.trim() || !skill.prompt.trim());
  const incompleteCombo = combos.some(
    (combo) =>
      !combo.label.trim() ||
      combo.steps.length < 2 ||
      combo.steps.some((step) => !step.label.trim() || !step.prompt.trim())
  );
  const incomplete = incompleteSkill || incompleteCombo;

  const requestClose = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    const discard = await confirm({
      title: 'Discard changes?',
      message: discardMessage,
      confirmLabel: 'Discard',
      variant: 'discard',
    });
    if (discard) onClose();
  };
  useOverlayLayer({
    id: 'quick-access-settings',
    kind: 'tool',
    active: true,
    onEscape: requestClose,
  });

  const handleSave = () => {
    if (incomplete) return;
    onSave({
      icon,
      // A library skill can sit on a slot whose pinned copy was deleted from
      // the list afterwards; saving pins it again rather than losing the slot.
      skills: pinSlottedLibrarySkills(skills, draftSlots, auricSkills).map((skill) => ({
        ...skill,
        label: skill.label.trim(),
        prompt: skill.prompt.trim(),
      })),
      combos: combos.map((combo) => ({
        ...combo,
        label: combo.label.trim(),
        steps: combo.steps.map((step) => ({
          ...step,
          label: step.label.trim(),
          prompt: step.prompt.trim(),
        })),
      })),
      wheelSlots: draftSlots,
    });
    onClose();
  };

  // Portalled: QuickAccess sits inside Mission Control's overflow-hidden
  // containers, which would clip a dialog rendered in place.
  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-tool)] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-access-settings-title"
        data-testid="quick-access-settings-dialog"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-5 overflow-y-auto rounded-xl border border-white/10 bg-background-dark p-6 shadow-2xl"
      >
        <header className="flex items-center gap-2">
          <AuricIcon name="settings" aria-hidden="true" className="text-primary" />
          <h2
            id="quick-access-settings-title"
            className="text-sm font-bold tracking-tight text-foreground"
          >
            {title}
          </h2>
        </header>

        {note && <p className="text-[11px] leading-relaxed text-foreground-muted">{note}</p>}

        {iconPath && (
          <QuickAccessIconPicker
            path={iconPath}
            value={icon}
            onChange={setIcon}
            onAnnounce={setAnnouncement}
          />
        )}

        <QuickAccessSkillsEditor
          skills={skills}
          providers={providers}
          discovered={discovered}
          auricSkills={auricSkills}
          discoveryReady={discoveryReady}
          onChange={setSkills}
          onAnnounce={setAnnouncement}
          fixedProvider={fixedProvider}
        />

        {showCombos && (
          <QuickAccessCombosEditor
            combos={combos}
            providers={providers}
            discovered={discovered}
            auricSkills={auricSkills}
            discoveryReady={discoveryReady}
            onChange={setCombos}
            onAnnounce={setAnnouncement}
          />
        )}

        <QuickAccessWheelEditor
          entries={entries}
          slots={draftSlots}
          onChange={changeWheelSlots}
          onAnnounce={setAnnouncement}
        />

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {incomplete && (
          <p className="text-[10px] text-amber-400/80">
            {incompleteCombo
              ? 'Every combo needs a name and at least two complete steps.'
              : 'Every skill needs a name and a prompt.'}
          </p>
        )}

        <footer className="flex justify-end gap-3 border-t border-white/5 pt-4">
          <button
            type="button"
            onClick={requestClose}
            className="rounded border border-border-dark px-3 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="quick-access-settings-save"
            onClick={handleSave}
            disabled={incomplete}
            className="rounded bg-primary px-3 py-1.5 text-sm text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </footer>
      </div>
      {confirmDialog}
    </div>,
    document.body
  );
}
