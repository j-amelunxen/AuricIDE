'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { normalizeProjectDescription } from '@/lib/quickAccess/description';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
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
  normalizeProjectPath,
  type SupervisorPolicy,
  type SupervisorPolicyRejection,
} from '@/lib/config/supervisorPolicy';
import {
  setProjectAllowed,
  unattendedBlockers,
  updateSupervisorProject,
} from '@/lib/config/supervisorPolicyEdit';
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
import { SupervisorProjectRow } from './SupervisorProjectRow';

interface Loaded {
  saved: SupervisorPolicy;
  rejected: SupervisorPolicyRejection[];
  providers: ProviderInfo[];
  projectPolicies: Record<string, ProviderPolicy>;
  /** The user's own skills, offered for approval; scanned once per visit. */
  skillCandidates: SupervisorSkillCandidate[];
}

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
 */
// code-gate: complexity-function-length - one save flow over policy, instructions and descriptions; the sections are already components
export function SupervisorContent() {
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
      ? `Pick a permission mode for ${blockers.length === 1 ? '1 provider' : `${blockers.length} providers`} that would run without asking`
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

  return (
    <div className="space-y-8">
      <p className="text-xs leading-relaxed text-foreground-muted">
        The Supervisor tile in Quick Access starts an agent that hands work to other agents in the
        projects you allow here. It never types into them and cannot go past these limits.
      </p>

      <RejectedNotice rejected={loaded.rejected} />

      <SupervisorHeader draft={draft} providers={loaded.providers} onChange={setDraft} />

      <SettingsSection title="Projects" icon="star">
        {starredProjects.length === 0 ? (
          <p className="text-xs text-foreground-muted">
            Star a project in Quick Access to offer it to the supervisor.
          </p>
        ) : (
          <div className="space-y-2">
            {starredProjects.map((project) => (
              <SupervisorProjectRow
                key={project.path}
                project={project}
                entry={draft.projects[normalizeProjectPath(project.path)]}
                providers={loaded.providers}
                projectPolicy={loaded.projectPolicies[project.path]}
                description={descriptions.value(project.path)}
                onDescriptionChange={(text) => descriptions.edit(project.path, text)}
                onAllowedChange={(allowed) =>
                  setDraft(setProjectAllowed(draft, project.path, allowed))
                }
                onChange={(entry) =>
                  setDraft(updateSupervisorProject(draft, project.path, () => entry))
                }
              />
            ))}
          </div>
        )}
      </SettingsSection>

      <SupervisorSkills
        skills={draft.skills}
        candidates={loaded.skillCandidates}
        onChange={(skills) => setDraft({ ...draft, skills })}
      />

      <SupervisorTools tools={draft.tools} onChange={(tools) => setDraft({ ...draft, tools })} />

      <SupervisorInstructionsEditor
        candidates={supervisorProvidersOf(draft)}
        providers={loaded.providers}
        instructions={instructions}
        onChange={setInstructions}
      />

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

      <SupervisorMenuBarSettings />
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
    <div className="flex flex-wrap items-center gap-3">
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
