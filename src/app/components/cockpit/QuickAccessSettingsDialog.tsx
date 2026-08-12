'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useStore } from '@/lib/store';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ConfirmDialog } from '@/app/components/ui/ConfirmDialog';
import { FALLBACK_CRUSH_PROVIDER, listProviders, type ProviderInfo } from '@/lib/tauri/providers';
import { listProjectSkills, type ProjectSkill } from '@/lib/tauri/projectSkills';
import { enabledSkillSources, loadSkillSources } from '@/lib/settings/skillSources';
import {
  quickAccessSkills,
  type ProjectIconOverride,
  type QuickAccessSkill,
  type StarredProject,
} from '@/lib/store/starredProjectsSlice';
import { QuickAccessIconPicker } from './QuickAccessIconPicker';
import { QuickAccessSkillsEditor } from './QuickAccessSkillsEditor';

interface QuickAccessSettingsDialogProps {
  project: StarredProject;
  onClose: () => void;
}

/**
 * Per-project Quick Access settings: the tile's mark, and the launch presets
 * offered in its right-click menu.
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
  const [announcement, setAnnouncement] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([FALLBACK_CRUSH_PROVIDER]);
  const [discovered, setDiscovered] = useState<ProjectSkill[]>([]);
  const [discoveryReady, setDiscoveryReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listProviders()
      .then((fetched) => {
        if (!cancelled && fetched.length > 0) setProviders(fetched);
      })
      .catch(() => {
        /* Browser mode — the fallback provider stands in. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const dirty =
    JSON.stringify({ icon, skills }) !==
    JSON.stringify({ icon: project.icon, skills: quickAccessSkills(project) });
  const incomplete = skills.some((skill) => !skill.label.trim() || !skill.prompt.trim());

  const requestClose = () => (dirty ? setConfirmDiscard(true) : onClose());

  const handleSave = () => {
    if (incomplete) return;
    updateStarredProjectSettings(project.path, {
      icon,
      skills: skills.map((skill) => ({
        ...skill,
        label: skill.label.trim(),
        prompt: skill.prompt.trim(),
      })),
    });
    onClose();
  };

  // Portalled: QuickAccess sits inside Mission Control's overflow-hidden
  // containers, which would clip a dialog rendered in place.
  return createPortal(
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-access-settings-title"
        data-testid="quick-access-settings-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // useDialogA11y traps Tab and restores focus, but leaves Escape and
          // the aria attributes to the consumer.
          if (event.key === 'Escape') {
            event.stopPropagation();
            requestClose();
          }
        }}
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
          discoveryReady={discoveryReady}
          onChange={setSkills}
          onAnnounce={setAnnouncement}
        />

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {incomplete && (
          <p className="text-[10px] text-amber-400/80">Every skill needs a name and a prompt.</p>
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
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          message="The edits to this project's Quick Access settings have not been saved."
          confirmLabel="Discard"
          onConfirm={onClose}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>,
    document.body
  );
}
