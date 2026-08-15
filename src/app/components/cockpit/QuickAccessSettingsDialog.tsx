'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { useStore } from '@/lib/store';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { FALLBACK_CRUSH_PROVIDER } from '@/lib/tauri/providers';
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

interface QuickAccessSettingsDialogProps {
  project: StarredProject;
  onClose: () => void;
}

/**
 * Per-project Quick Access settings: the tile's mark, and the launch presets
 * that the radial wheel can pin to a slot.
 *
 * The panel is split out so it remounts per open and the draft always starts
 * from the persisted settings — the same shape SpawnAgentDialog uses.
 */
export function QuickAccessSettingsDialog({ project, onClose }: QuickAccessSettingsDialogProps) {
  return <QuickAccessSettingsPanel key={project.path} project={project} onClose={onClose} />;
}

function QuickAccessSettingsPanel({ project, onClose }: QuickAccessSettingsDialogProps) {
  const updateStarredProjectSettings = useStore((s) => s.updateStarredProjectSettings);
  const dialogRef = useDialogA11y<HTMLDivElement>();

  const [icon, setIcon] = useState<ProjectIconOverride | undefined>(project.icon);
  const [skills, setSkills] = useState<QuickAccessSkill[]>(quickAccessSkills(project));
  const [combos, setCombos] = useState<QuickAccessCombo[]>(quickAccessCombos(project));
  const [wheelSlots, setWheelSlots] = useState<(string | null)[]>(quickAccessWheelSlots(project));
  const [announcement, setAnnouncement] = useState('');
  const { confirm, confirmDialog } = useConfirm();
  const [discovered, setDiscovered] = useState<ProjectSkill[]>([]);
  const [discoveryReady, setDiscoveryReady] = useState(false);
  const [auricSkills] = useState(loadAuricSkills);
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

  // The skills list is a draft, so what the wheel may hold moves with it. Both
  // sides of the dirty check are normalised against their own set of ids —
  // otherwise deleting a slotted skill would read as an edit to the wheel too.
  const entries = launchEntries(skills, combos);
  const draftSlots = normalizeWheelSlots(wheelSlots, entries.map(wheelSlotId));

  const dirty =
    JSON.stringify({ icon, skills, combos, wheelSlots: draftSlots }) !==
    JSON.stringify({
      icon: project.icon,
      skills: quickAccessSkills(project),
      combos: quickAccessCombos(project),
      wheelSlots: normalizeWheelSlots(
        quickAccessWheelSlots(project),
        launchEntries(quickAccessSkills(project), quickAccessCombos(project)).map(wheelSlotId)
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
      message: "The edits to this project's Quick Access settings have not been saved.",
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
    updateStarredProjectSettings(project.path, {
      icon,
      skills: skills.map((skill) => ({
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
            Quick Access — {project.name}
          </h2>
        </header>

        <QuickAccessIconPicker
          path={project.path}
          value={icon}
          onChange={setIcon}
          onAnnounce={setAnnouncement}
        />

        <QuickAccessSkillsEditor
          skills={skills}
          providers={providers}
          discovered={discovered}
          auricSkills={auricSkills}
          discoveryReady={discoveryReady}
          onChange={setSkills}
          onAnnounce={setAnnouncement}
        />

        <QuickAccessCombosEditor
          combos={combos}
          providers={providers}
          discovered={discovered}
          auricSkills={auricSkills}
          discoveryReady={discoveryReady}
          onChange={setCombos}
          onAnnounce={setAnnouncement}
        />

        <QuickAccessWheelEditor
          entries={entries}
          slots={draftSlots}
          onChange={setWheelSlots}
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
