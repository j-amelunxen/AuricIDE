'use client';

import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsToggle } from '../../ui/settings/SettingsToggle';
import {
  loadSkillSources,
  saveSkillSources,
  type SkillSourceRule,
} from '@/lib/settings/skillSources';

const FIELD_CLASS =
  'w-full rounded border border-border-dark bg-editor-bg px-2 py-1.5 text-[11px] text-foreground placeholder:text-foreground-muted/60 focus:border-primary focus:outline-none';

/**
 * Where Quick Access looks for skills.
 *
 * Which directory layout applies depends on which agent CLI you run, so this
 * is a user setting rather than a constant. Only the Claude convention ships
 * as a preset — it is the one verified against real files. Other agents get a
 * custom rule instead of a guessed preset: a preset that quietly matches
 * nothing is worse than an empty field that says what it wants.
 */
export function SkillDiscoveryContent() {
  const [sources, setSources] = useState<SkillSourceRule[]>(() => loadSkillSources());

  const commit = (next: SkillSourceRule[]) => {
    setSources(next);
    saveSkillSources(next);
  };

  const update = (id: string, patch: Partial<SkillSourceRule>) =>
    commit(sources.map((source) => (source.id === id ? { ...source, ...patch } : source)));

  const addCustom = () =>
    commit([
      ...sources,
      {
        id: crypto.randomUUID(),
        label: '',
        commandsDir: '',
        skillsDir: '',
        manifest: 'SKILL.md',
        extension: 'md',
        enabled: true,
      },
    ]);

  return (
    <SettingsSection title="Skill Discovery" icon="auto_awesome">
      <p className="text-xs leading-relaxed text-foreground-muted">
        Quick Access can show skills defined by your agent CLIs. Each source is searched in the
        project folder <em>and</em> your home directory.
      </p>

      <ul className="flex flex-col gap-2" data-testid="skill-source-list">
        {sources.map((source) => (
          <li
            key={source.id}
            data-testid={`skill-source-${source.id}`}
            className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
          >
            <SettingsToggle
              label={source.label || 'Custom source'}
              description={
                source.id === 'claude'
                  ? '.claude/commands and .claude/skills'
                  : 'Custom folder layout'
              }
              checked={source.enabled}
              onChange={(enabled) => update(source.id, { enabled })}
              testId={`skill-source-toggle-${source.id}`}
            />
            {source.id !== 'claude' && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="col-span-2">
                  <span className="sr-only">Source name</span>
                  <input
                    aria-label="Source name"
                    value={source.label}
                    placeholder="My Agent"
                    onChange={(event) => update(source.id, { label: event.target.value })}
                    className={FIELD_CLASS}
                  />
                </label>
                <label>
                  <span className="sr-only">Commands directory</span>
                  <input
                    aria-label="Commands directory"
                    value={source.commandsDir ?? ''}
                    placeholder=".myagent/commands"
                    onChange={(event) => update(source.id, { commandsDir: event.target.value })}
                    className={`${FIELD_CLASS} font-mono`}
                  />
                </label>
                <label>
                  <span className="sr-only">Skills directory</span>
                  <input
                    aria-label="Skills directory"
                    value={source.skillsDir ?? ''}
                    placeholder=".myagent/skills"
                    onChange={(event) => update(source.id, { skillsDir: event.target.value })}
                    className={`${FIELD_CLASS} font-mono`}
                  />
                </label>
                <label>
                  <span className="sr-only">Manifest file</span>
                  <input
                    aria-label="Manifest file"
                    value={source.manifest ?? ''}
                    placeholder="SKILL.md"
                    onChange={(event) => update(source.id, { manifest: event.target.value })}
                    className={`${FIELD_CLASS} font-mono`}
                  />
                </label>
                <div className="flex items-center gap-2">
                  <label className="flex-1">
                    <span className="sr-only">File extension</span>
                    <input
                      aria-label="File extension"
                      value={source.extension}
                      placeholder="md"
                      onChange={(event) => update(source.id, { extension: event.target.value })}
                      className={`${FIELD_CLASS} font-mono`}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove ${source.label || 'custom source'}`}
                    onClick={() => commit(sources.filter((s) => s.id !== source.id))}
                    className="rounded p-1 text-red-400/80 transition-colors hover:text-red-400"
                  >
                    <AuricIcon name="delete" aria-hidden="true" className="text-[14px]" />
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        data-testid="add-skill-source"
        onClick={addCustom}
        className="flex items-center gap-1.5 rounded bg-white/5 px-3 py-1.5 text-[11px] text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
      >
        <AuricIcon name="add" aria-hidden="true" className="text-[14px]" />
        Add source
      </button>
    </SettingsSection>
  );
}
