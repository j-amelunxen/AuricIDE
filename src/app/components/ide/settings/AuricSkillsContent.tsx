'use client';

import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import {
  loadAuricSkills,
  saveAuricSkills,
  type AuricSkillDefinition,
} from '@/lib/settings/auricSkills';

const FIELD_CLASS =
  'w-full rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-primary/30 focus:ring-1 focus:ring-primary/20';

function emptySkill(): AuricSkillDefinition {
  return { id: crypto.randomUUID(), name: '', description: '', prompt: '' };
}

/** Application-wide prompt skills. Harnesses only receive the resolved text. */
export function AuricSkillsContent() {
  const [skills, setSkills] = useState<AuricSkillDefinition[]>(loadAuricSkills);
  const [saved, setSaved] = useState(true);
  const incomplete = skills.some((skill) => !skill.name.trim() || !skill.prompt.trim());

  const commitDraft = (next: AuricSkillDefinition[]) => {
    setSkills(next);
    setSaved(false);
  };

  const update = (index: number, patch: Partial<AuricSkillDefinition>) =>
    commitDraft(skills.map((skill, i) => (i === index ? { ...skill, ...patch } : skill)));

  const handleSave = () => {
    if (incomplete) return;
    const normalized = skills.map((skill) => ({
      ...skill,
      name: skill.name.trim(),
      description: skill.description?.trim() || undefined,
      prompt: skill.prompt.trim(),
    }));
    saveAuricSkills(normalized);
    setSkills(normalized);
    setSaved(true);
  };

  return (
    <div className="space-y-8">
      <SettingsSection title="Auric Skills" icon="auto_awesome">
        <p className="max-w-[70ch] text-xs leading-relaxed text-foreground-muted">
          Prompt-based skills available to every project and every agent harness. Projects choose
          which ones appear in Quick Access, wheels and combos.
        </p>

        {skills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-center">
            <p className="text-xs font-medium text-foreground">No Auric skills yet</p>
            <p className="mt-1 text-[11px] text-foreground-muted">
              Add one reusable instruction, then select it inside any Quick Access project.
            </p>
          </div>
        ) : (
          <ul aria-label="Auric skills" className="divide-y divide-white/5 border-y border-white/5">
            {skills.map((skill, index) => (
              <li key={skill.id} className="py-4" data-testid={`auric-skill-${skill.id}`}>
                <div className="flex items-start gap-3">
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                    <input
                      aria-label={`Auric skill ${index + 1} name`}
                      value={skill.name}
                      placeholder="Skill name"
                      onChange={(event) => update(index, { name: event.target.value })}
                      className={FIELD_CLASS}
                    />
                    <input
                      aria-label={`Auric skill ${index + 1} description`}
                      value={skill.description ?? ''}
                      placeholder="Short description (optional)"
                      onChange={(event) => update(index, { description: event.target.value })}
                      className={FIELD_CLASS}
                    />
                    <textarea
                      aria-label={`Auric skill ${index + 1} prompt`}
                      value={skill.prompt}
                      placeholder="Full instruction injected into the agent context"
                      rows={5}
                      onChange={(event) => update(index, { prompt: event.target.value })}
                      className={`${FIELD_CLASS} col-span-2 resize-y font-mono leading-relaxed`}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${skill.name || `Auric skill ${index + 1}`}`}
                    onClick={() => commitDraft(skills.filter((_, i) => i !== index))}
                    className="rounded p-2 text-foreground-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <AuricIcon name="delete" aria-hidden="true" className="text-[16px]" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            data-testid="auric-skill-add"
            onClick={() => commitDraft([...skills, emptySkill()])}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <AuricIcon name="add" aria-hidden="true" className="text-[15px]" />
            Add skill
          </button>
          <div className="flex items-center gap-3">
            {incomplete && (
              <span className="text-[10px] text-amber-400/80">Name and prompt are required.</span>
            )}
            {saved && skills.length > 0 && (
              <span className="text-[10px] text-foreground-muted">Saved</span>
            )}
            <button
              type="button"
              data-testid="auric-skills-save"
              onClick={handleSave}
              disabled={saved || incomplete}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save library
            </button>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
