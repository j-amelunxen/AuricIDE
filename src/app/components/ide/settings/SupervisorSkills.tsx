'use client';

import { useState } from 'react';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { LearnMore, SETTINGS_HINT_CLASS } from '@/app/components/ui/settings/SettingsGroup';
import {
  isBashPattern,
  normalizeProjectPath,
  type SupervisorSkillPolicy,
} from '@/lib/config/supervisorPolicy';

/** A skill folder the catalogue found, offered for approval. */
export interface SupervisorSkillCandidate {
  folder: string;
  name: string;
  description: string | null;
}

/** `/a/b/SKILL.md` → `/a/b`: a skill is approved by its folder. */
export function skillFolderOf(skillFile: string): string {
  return skillFile.replace(/\/SKILL\.md$/i, '');
}

function skillName(folder: string): string {
  return normalizeProjectPath(folder).split('/').pop() ?? folder;
}

/** The lines of the pattern box that Rust would refuse. */
export function invalidBashPatterns(skills: Record<string, SupervisorSkillPolicy>): string[] {
  return Object.values(skills).flatMap((skill) => [
    ...skill.bash.filter((pattern) => !isBashPattern(pattern)),
    ...skill.dirs.filter((dir) => !isExtraDir(dir)),
  ]);
}

/** What Rust accepts as an extra folder; a blank line is dropped there, not refused. */
export function isExtraDir(dir: string): boolean {
  const trimmed = dir.trim();
  return !trimmed || (trimmed.startsWith('/') && trimmed !== '/' && isBashPattern(trimmed));
}

interface SupervisorSkillsProps {
  skills: Record<string, SupervisorSkillPolicy>;
  candidates: SupervisorSkillCandidate[];
  onChange: (skills: Record<string, SupervisorSkillPolicy>) => void;
}

/**
 * The skills a supervisor run may load (ADR 0004). Approving one links its
 * folder into the run's plugin; its shell patterns are the only Bash commands
 * the supervisor may run, everything else is refused without asking.
 */
export function SupervisorSkills({ skills, candidates, onChange }: SupervisorSkillsProps) {
  const [newFolder, setNewFolder] = useState('');
  const approved = Object.keys(skills).sort();
  const folder = normalizeProjectPath(newFolder.trim());
  const addReason = !folder.startsWith('/')
    ? 'Enter the absolute path of the folder that holds SKILL.md'
    : skills[folder]
      ? 'This skill is approved already'
      : null;

  const add = () => {
    if (addReason) return;
    onChange({ ...skills, [folder]: { bash: [`${folder}/scripts/*`], dirs: [] } });
    setNewFolder('');
  };
  const remove = (path: string) => {
    const next = { ...skills };
    delete next[path];
    onChange(next);
  };
  const setPatterns = (path: string, text: string) =>
    onChange({ ...skills, [path]: { ...skills[path], bash: text.split('\n') } });
  const setDirs = (path: string, text: string) =>
    onChange({ ...skills, [path]: { ...skills[path], dirs: text.split('\n') } });

  return (
    <SettingsSection title="Skills" icon="bolt">
      <div className="space-y-1">
        <p className={SETTINGS_HINT_CLASS}>
          Skills a supervisor run may load, and the only shell commands it may run. Approve a skill
          only if its commands are safe to run unattended.
        </p>
        <LearnMore>
          <p>
            Each run works in its own folder, <code>~/.auric/supervisors/&lt;start time&gt;/</code>,
            and may read and write there. It has a shell only for the commands listed under an
            approved skill; any other command is refused without asking.
          </p>
        </LearnMore>
      </div>
      {approved.length === 0 ? (
        <p className={SETTINGS_HINT_CLASS}>No skill is approved.</p>
      ) : (
        <ul className="space-y-2">
          {approved.map((path) => (
            <SkillRow
              key={path}
              path={path}
              patterns={skills[path].bash}
              dirs={skills[path].dirs}
              onPatterns={(text) => setPatterns(path, text)}
              onDirs={(text) => setDirs(path, text)}
              onRemove={() => remove(path)}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          list="supervisor-skill-candidates"
          data-testid="supervisor-skill-folder"
          aria-label="Skill folder"
          placeholder="/Users/you/.claude/skills/my-skill"
          value={newFolder}
          onChange={(e) => setNewFolder(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-foreground"
        />
        <datalist id="supervisor-skill-candidates">
          {candidates
            .filter((candidate) => !skills[candidate.folder])
            .map((candidate) => (
              <option key={candidate.folder} value={candidate.folder}>
                {candidate.name}
              </option>
            ))}
        </datalist>
        <button
          type="button"
          data-testid="supervisor-skill-add"
          onClick={add}
          disabled={addReason !== null}
          title={addReason ?? undefined}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-foreground transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          Approve skill
        </button>
      </div>
    </SettingsSection>
  );
}

interface SkillRowProps {
  path: string;
  patterns: string[];
  dirs: string[];
  onPatterns: (text: string) => void;
  onDirs: (text: string) => void;
  onRemove: () => void;
}

function SkillRow({ path, patterns, dirs, onPatterns, onDirs, onRemove }: SkillRowProps) {
  const invalid = patterns.filter((pattern) => !isBashPattern(pattern));
  const invalidDirs = dirs.filter((dir) => !isExtraDir(dir));
  const id = `supervisor-skill-${skillName(path)}`;
  return (
    <li
      data-testid="supervisor-skill-row"
      className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-3"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-foreground">/{skillName(path)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground-muted">
          {path}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove /${skillName(path)}`}
          className="rounded px-2 py-0.5 text-[11px] text-foreground-muted transition-colors hover:text-foreground"
        >
          Remove
        </button>
      </div>
      <label htmlFor={id} className="block text-[11px] text-foreground-muted">
        Shell commands it may run, one pattern per line (empty: no shell)
      </label>
      <textarea
        id={id}
        rows={Math.max(2, patterns.length)}
        value={patterns.join('\n')}
        onChange={(e) => onPatterns(e.target.value)}
        aria-invalid={invalid.length > 0}
        className="w-full rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-foreground"
      />
      {invalid.length > 0 && (
        <p role="alert" className="text-[11px] text-red-400">
          A pattern may not contain brackets, quotes, backticks or backslashes.
        </p>
      )}
      <label htmlFor={`${id}-dirs`} className="block text-[11px] text-foreground-muted">
        Extra folders it may read and write besides the run folder, one absolute path per line
      </label>
      <textarea
        id={`${id}-dirs`}
        rows={Math.max(1, dirs.length)}
        value={dirs.join('\n')}
        onChange={(e) => onDirs(e.target.value)}
        aria-invalid={invalidDirs.length > 0}
        className="w-full rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-foreground"
      />
      {invalidDirs.length > 0 && (
        <p role="alert" className="text-[11px] text-red-400">
          A folder must be an absolute path other than /, without brackets, quotes or backslashes.
        </p>
      )}
    </li>
  );
}
