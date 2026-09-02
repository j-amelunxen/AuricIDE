'use client';

import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import {
  loadAuricSkills,
  mergeAuricSkills,
  parseAuricSkillsJson,
  saveAuricSkills,
  serializeAuricSkills,
  type AuricSkillDefinition,
} from '@/lib/settings/auricSkills';
import { useStore } from '@/lib/store';

const FIELD_CLASS =
  'w-full rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-primary/30 focus:ring-1 focus:ring-primary/20';

const GHOST_BUTTON_CLASS =
  'flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

function emptySkill(): AuricSkillDefinition {
  return { id: crypto.randomUUID(), name: '', description: '', prompt: '' };
}

function isComplete(skill: AuricSkillDefinition): boolean {
  return skill.name.trim().length > 0 && skill.prompt.trim().length > 0;
}

function normalizeLibrary(skills: AuricSkillDefinition[]): AuricSkillDefinition[] {
  return skills.map((skill) => ({
    ...skill,
    name: skill.name.trim(),
    description: skill.description?.trim() || undefined,
    prompt: skill.prompt.trim(),
  }));
}

function importSummary(added: number, updated: number): string {
  if (added && updated) return `Added ${added}, updated ${updated}`;
  if (updated) {
    return updated === 1 ? 'Updated 1 Auric skill' : `Updated ${updated} Auric skills`;
  }
  return added === 1 ? 'Imported 1 Auric skill' : `Imported ${added} Auric skills`;
}

/** Application-wide prompt skills. Harnesses only receive the resolved text. */
export function AuricSkillsContent() {
  const [skills, setSkills] = useState<AuricSkillDefinition[]>(loadAuricSkills);
  const [saved, setSaved] = useState(true);
  const showToast = useStore((s) => s.showToast);
  const incomplete = skills.some((skill) => !isComplete(skill));
  const canExport = skills.some(isComplete);

  const commitDraft = (next: AuricSkillDefinition[]) => {
    setSkills(next);
    setSaved(false);
  };

  const applyLibrary = (next: AuricSkillDefinition[], persist: boolean) => {
    setSkills(next);
    if (persist) {
      saveAuricSkills(next);
      setSaved(true);
    } else {
      setSaved(false);
    }
  };

  const update = (index: number, patch: Partial<AuricSkillDefinition>) =>
    commitDraft(skills.map((skill, i) => (i === index ? { ...skill, ...patch } : skill)));

  const handleSave = () => {
    if (incomplete) return;
    applyLibrary(normalizeLibrary(skills), true);
  };

  const handleExport = async () => {
    const payload = serializeAuricSkills(skills);
    const parsed = parseAuricSkillsJson(payload);
    if (!parsed.ok || parsed.skills.length === 0) return;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: 'auric-skills.json',
        title: 'Export Auric skills',
      });
      if (!path) return;
      const { writeFile } = await import('@/lib/tauri/fs');
      await writeFile(path, payload);
      showToast(
        parsed.skills.length === 1
          ? 'Exported 1 Auric skill'
          : `Exported ${parsed.skills.length} Auric skills`,
        'success'
      );
    } catch (err) {
      showToast(typeof err === 'string' ? err : 'Could not export Auric skills', 'error');
    }
  };

  const handleImport = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        title: 'Import Auric skills',
      });
      if (!selected || typeof selected !== 'string') return;
      const { readFile } = await import('@/lib/tauri/fs');
      const parsed = parseAuricSkillsJson(await readFile(selected));
      if (!parsed.ok) {
        showToast(parsed.error, 'error');
        return;
      }
      if (parsed.skills.length === 0) {
        showToast('No skills in this file', 'info');
        return;
      }
      const merged = mergeAuricSkills(skills, parsed.skills);
      const next = normalizeLibrary(merged.skills);
      const persist = next.every(isComplete);
      applyLibrary(next, persist);
      const summary = importSummary(merged.added, merged.updated);
      showToast(
        persist ? summary : `${summary}. Save the library to keep it.`,
        persist ? 'success' : 'info'
      );
    } catch (err) {
      showToast(typeof err === 'string' ? err : 'Could not import Auric skills', 'error');
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection title="Auric Skills" icon="auto_awesome">
        <p className="max-w-[70ch] text-xs leading-relaxed text-foreground-muted">
          Reusable prompt skills available across your projects. Choose which skills appear in Quick
          Access. Export the library, or import one: matching ids update, new ids are added.
        </p>

        {skills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-center">
            <p className="text-xs font-medium text-foreground">No Auric skills yet</p>
            <p className="mt-1 text-[11px] text-foreground-muted">
              Add a reusable instruction or import a library, then choose it in a project&apos;s
              Quick Access.
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
                      placeholder="Instruction provided to the agent when you use this skill"
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="auric-skill-add"
              onClick={() => commitDraft([...skills, emptySkill()])}
              className={GHOST_BUTTON_CLASS}
            >
              <AuricIcon name="add" aria-hidden="true" className="text-[15px]" />
              Add skill
            </button>
            <button
              type="button"
              data-testid="auric-skills-import"
              onClick={() => void handleImport()}
              className={GHOST_BUTTON_CLASS}
            >
              <AuricIcon name="upload" aria-hidden="true" className="text-[15px]" />
              Import…
            </button>
            <button
              type="button"
              data-testid="auric-skills-export"
              onClick={() => void handleExport()}
              disabled={!canExport}
              title={canExport ? undefined : 'Nothing complete to export'}
              aria-label={canExport ? undefined : 'Export, nothing complete to export'}
              className={GHOST_BUTTON_CLASS}
            >
              <AuricIcon name="download" aria-hidden="true" className="text-[15px]" />
              Export…
            </button>
          </div>
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
