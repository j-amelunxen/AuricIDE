'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '@/lib/store';
import { normalizeProjectDescription } from '@/lib/quickAccess/description';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { SupervisorLinkSettings } from './SupervisorLinkSettings';
import { SupervisorManagersSettings } from './SupervisorManagersSettings';
import { SupervisorMenuBarSettings } from './SupervisorMenuBarSettings';
import { SupervisorHeader } from './SupervisorHeader';
import { SupervisorInstructionsEditor } from './SupervisorInstructionsEditor';
import { readProjectProviderPolicies } from '@/lib/agents/supervisorLaunch';
import {
  readAllSupervisorInstructions,
  supervisorProvidersOf,
  writeSupervisorInstructions,
} from '@/lib/config/supervisorProviders';
import type { ProviderPolicy } from '@/lib/config/providerPolicy';
import {
  SUPERVISOR_PARSE_REASONS,
  type SupervisorPolicy,
  type SupervisorPolicyRejection,
} from '@/lib/config/supervisorPolicy';
import { unattendedBlockers } from '@/lib/config/supervisorPolicyEdit';
import { listProviders, type ProviderInfo } from '@/lib/tauri/providers';
import { supervisorPolicyGet, supervisorPolicySet } from '@/lib/tauri/supervisorPolicy';
import { listProjectSkills } from '@/lib/tauri/projectSkills';
import { enabledSkillSources, loadSkillSources } from '@/lib/settings/skillSources';
import {
  SupervisorSkills,
  invalidBashPatterns,
  skillFolderOf,
  type SupervisorSkillCandidate,
} from './SupervisorSkills';
import { SupervisorTools, invalidToolEntries } from './SupervisorTools';
import { SupervisorConnectors } from './SupervisorConnectors';
import { SupervisorProjectsPage } from './SupervisorProjectsPage';
import { SETTINGS_HINT_CLASS } from '@/app/components/ui/settings/SettingsGroup';

interface Loaded {
  saved: SupervisorPolicy;
  rejected: SupervisorPolicyRejection[];
  providers: ProviderInfo[];
  projectPolicies: Record<string, ProviderPolicy>;
  /** The user's own skills, offered for approval; scanned once per visit. */
  skillCandidates: SupervisorSkillCandidate[];
}

/**
 * The pages of Settings → Supervisor, in navigation order. One long page buried
 * the Save button between sections that save on their own.
 */
export const SUPERVISOR_SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'projects', label: 'Projects' },
  { id: 'skills', label: 'Skills' },
  { id: 'tools', label: 'Tools' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'managers', label: 'Project Managers' },
  { id: 'menu-bar', label: 'Menu bar' },
  { id: 'link', label: 'Supervisor link' },
] as const;

export type SupervisorSection = (typeof SUPERVISOR_SECTIONS)[number]['id'];

/** These apply each change at once and are not part of what the save bar writes. */
const SELF_SAVING_SECTIONS: ReadonlySet<SupervisorSection> = new Set([
  'managers',
  'menu-bar',
  'link',
]);

/** User-level skills only: a project's skills belong to that project's agents. */
async function readSkillCandidates(projectPath: string | undefined) {
  if (!projectPath) return [];
  const found = await listProjectSkills(projectPath, enabledSkillSources(loadSkillSources()));
  return found
    .filter((skill) => skill.source === 'skill' && skill.scope === 'user')
    .map((skill) => ({
      folder: skillFolderOf(skill.path),
      name: skill.name,
      description: skill.description,
    }));
}

/**
 * Settings → Supervisor (ADR 0004). Which starred projects the supervisor may
 * start agents in, and with which providers, models and permission modes.
 *
 * Saved on an explicit button, not per change: this is the one file that
 * widens what an agent may do on its own, and a half-made edit should not be
 * in force while the next box is still being ticked. Rust validates the file
 * again before it writes it, and reads it on every spawn.
 *
 * Every section stays mounted and only the picked one is shown, so moving
 * between pages keeps every unsaved edit, the link's own drafts included.
 */
// code-gate: complexity-function-length - one save flow over policy, instructions and descriptions; the sections are already components
export function SupervisorContent({ section }: { section: SupervisorSection }) {
  const starredProjects = useStore((s) => s.starredProjects);
  const showToast = useStore((s) => s.showToast);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SupervisorPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  // An app preference, not part of the policy file: it steers, it grants nothing.
  const [savedInstructions, setSavedInstructions] = useState<Record<string, string>>(
    readAllSupervisorInstructions
  );
  const [instructions, setInstructions] = useState<Record<string, string>>(savedInstructions);
  const descriptions = useDescriptionDrafts();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [state, providers, projectPolicies, skillCandidates] = await Promise.all([
          supervisorPolicyGet(),
          listProviders().catch(() => [] as ProviderInfo[]),
          readProjectProviderPolicies(starredProjects.map((p) => p.path)),
          readSkillCandidates(starredProjects[0]?.path),
        ]);
        if (cancelled) return;
        setLoaded({
          saved: state.policy,
          rejected: state.rejected,
          providers,
          projectPolicies,
          skillCandidates,
        });
        setDraft(state.policy);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Loaded once per visit: a re-read would throw away unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadError) {
    return (
      <SettingsSection title="Supervisor" icon="account_tree">
        <p role="alert" className="text-xs text-red-400">
          Could not read the supervisor settings: {loadError}
        </p>
      </SettingsSection>
    );
  }
  if (!loaded || !draft) {
    return <p className="text-xs text-foreground-muted">Loading supervisor settings…</p>;
  }

  const policyDirty = JSON.stringify(draft) !== JSON.stringify(loaded.saved);
  const instructionsDirty = JSON.stringify(instructions) !== JSON.stringify(savedInstructions);
  const dirty = policyDirty || instructionsDirty || descriptions.dirty;
  // Rust refuses these at spawn anyway; saving them would only store a choice
  // that can never run.
  const blockers = unattendedBlockers(draft, loaded.providers, loaded.projectPolicies);
  const badPatterns = invalidBashPatterns(draft.skills);
  const badToolEntries = invalidToolEntries(draft.tools);
  const blockedReason =
    blockers.length > 0
      ? `Pick a permission mode under Projects for ${blockers.length === 1 ? '1 provider' : `${blockers.length} providers`} that would run without asking`
      : badPatterns.length > 0
        ? 'Fix the entry marked under Skills'
        : badToolEntries.length > 0
          ? 'Fix the entry marked under Tools'
          : null;

  const save = async () => {
    setSaving(true);
    try {
      // Rust answers with the file as it now reads it; that is the new baseline.
      if (instructionsDirty) {
        writeSupervisorInstructions(instructions);
        setSavedInstructions(readAllSupervisorInstructions());
      }
      descriptions.save();
      if (policyDirty) {
        const state = await supervisorPolicySet(draft);
        setLoaded({ ...loaded, saved: state.policy, rejected: state.rejected });
        setDraft(state.policy);
      }
      showToast('Supervisor settings saved', 'success');
    } catch (error) {
      showToast(`Could not save the supervisor settings: ${String(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const page = (id: SupervisorSection, children: ReactNode) => (
    <div data-testid={`supervisor-section-${id}`} hidden={section !== id} className="space-y-8">
      {children}
    </div>
  );

  return (
    <div className="space-y-8">
      {page(
        'general',
        <>
          <p className={SETTINGS_HINT_CLASS}>
            The Supervisor tile in Quick Access starts an agent that hands work to other agents in
            the projects you allow here. It never types into them and cannot go past these limits.
          </p>
          <RejectedNotice rejected={loaded.rejected} />
          <SupervisorHeader draft={draft} providers={loaded.providers} onChange={setDraft} />
        </>
      )}

      {page(
        'projects',
        <>
          <SettingsSection title="Projects" icon="star">
            <p className={SETTINGS_HINT_CLASS}>
              The starred projects the supervisor may start agents in, and with what. Open a project
              to choose its providers, models and limits.
            </p>
            <SupervisorProjectsPage
              projects={starredProjects}
              draft={draft}
              saved={loaded.saved}
              providers={loaded.providers}
              projectPolicies={loaded.projectPolicies}
              blockers={blockers}
              descriptions={descriptions}
              onChange={setDraft}
            />
          </SettingsSection>
          <SupervisorConnectors policy={draft} onChange={setDraft} />
        </>
      )}

      {page(
        'skills',
        <SupervisorSkills
          skills={draft.skills}
          candidates={loaded.skillCandidates}
          onChange={(skills) => setDraft({ ...draft, skills })}
        />
      )}

      {page(
        'tools',
        <SupervisorTools tools={draft.tools} onChange={(tools) => setDraft({ ...draft, tools })} />
      )}

      {page(
        'instructions',
        <SupervisorInstructionsEditor
          candidates={supervisorProvidersOf(draft)}
          providers={loaded.providers}
          instructions={instructions}
          onChange={setInstructions}
        />
      )}

      {page('managers', <SupervisorManagersSettings />)}

      {page('menu-bar', <SupervisorMenuBarSettings />)}

      {page('link', <SupervisorLinkSettings />)}

      {/* Edits made on one page are still waiting while another is shown, so the
          bar stays in view wherever they are, and also on a self-saving page then. */}
      {(dirty || !SELF_SAVING_SECTIONS.has(section)) && (
        <SaveBar
          saving={saving}
          dirty={dirty}
          blockedReason={blockedReason}
          onSave={() => void save()}
          onDiscard={() => {
            setDraft(loaded.saved);
            setInstructions(savedInstructions);
            descriptions.discard();
          }}
        />
      )}
    </div>
  );
}

/**
 * The projects' own descriptions, edited here and saved with the page. The
 * saved text stays on the starred record, so a row without a draft shows that,
 * and an edit made in Quick Access meanwhile is not overwritten by a stale copy.
 */
function useDescriptionDrafts() {
  const starredProjects = useStore((s) => s.starredProjects);
  const setStarredProjectDescription = useStore((s) => s.setStarredProjectDescription);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const changed = starredProjects.filter(
    (p) =>
      p.path in drafts &&
      normalizeProjectDescription(drafts[p.path]) !== normalizeProjectDescription(p.description)
  );
  return {
    dirty: changed.length > 0,
    isDirty: (path: string) => changed.some((p) => p.path === path),
    value: (path: string) =>
      drafts[path] ?? starredProjects.find((p) => p.path === path)?.description ?? '',
    edit: (path: string, text: string) => setDrafts({ ...drafts, [path]: text }),
    save: () => {
      for (const project of changed)
        setStarredProjectDescription(project.path, drafts[project.path]);
      setDrafts({});
    },
    discard: () => setDrafts({}),
  };
}

function RejectedNotice({ rejected }: { rejected: SupervisorPolicyRejection[] }) {
  if (rejected.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="supervisor-rejected"
      className="space-y-1 rounded-lg border border-white/10 bg-white/5 p-3 text-[11px] text-foreground"
    >
      <p className="font-semibold">Parts of the saved file were ignored:</p>
      <ul className="list-disc space-y-0.5 pl-4 text-foreground-muted">
        {rejected.map((entry, index) => (
          <li key={`${entry.project ?? entry.skill ?? entry.tool ?? 'file'}-${index}`}>
            {(entry.project ?? entry.skill ?? entry.tool)
              ? `${entry.project ?? entry.skill ?? entry.tool}: `
              : ''}
            {SUPERVISOR_PARSE_REASONS[entry.reason] ?? entry.reason}
          </li>
        ))}
      </ul>
      <p className="text-foreground-muted">Saving writes a clean file.</p>
    </div>
  );
}

interface SaveBarProps {
  saving: boolean;
  dirty: boolean;
  /** Why saving is refused even though something changed; shown, not only implied. */
  blockedReason: string | null;
  onSave: () => void;
  onDiscard: () => void;
}

function SaveBar({ saving, dirty, blockedReason, onSave, onDiscard }: SaveBarProps) {
  return (
    <div className="sticky bottom-[-1.5rem] z-10 -mx-6 -mb-6 flex flex-wrap items-center gap-3 border-t border-white/10 bg-surface px-6 py-3">
      <button
        type="button"
        data-testid="supervisor-save"
        onClick={onSave}
        disabled={saving || !dirty || blockedReason !== null}
        title={blockedReason ?? (!dirty ? 'Nothing changed since the last save' : undefined)}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save supervisor settings'}
      </button>
      {dirty && (
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:text-foreground"
        >
          Discard changes
        </button>
      )}
      <span
        data-testid="supervisor-save-hint"
        className={`text-[10px] ${blockedReason ? 'text-red-400' : 'text-foreground-muted'}`}
      >
        {blockedReason ?? (dirty ? 'Unsaved changes' : 'No unsaved changes')}
      </span>
    </div>
  );
}
