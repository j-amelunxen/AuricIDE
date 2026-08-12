'use client';

import { useEffect, useRef, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import type { ProviderInfo } from '@/lib/tauri/providers';
import type { PermissionMode } from '@/lib/tauri/agents';
import type { ProjectSkill, ProjectSkillScope } from '@/lib/tauri/projectSkills';
import type { QuickAccessSkill } from '@/lib/store/starredProjectsSlice';
import { SkillInvocationInput } from './SkillInvocationInput';

const SELECT_CLASS =
  'w-full rounded bg-white/5 px-2 py-1.5 text-[11px] text-foreground outline-none disabled:opacity-40';
const INPUT_CLASS =
  'min-w-0 flex-1 rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/40';

/** Project definitions first: they are the specific answer, user ones the generic. */
const SCOPE_ORDER: { scope: ProjectSkillScope; title: string }[] = [
  { scope: 'project', title: 'In this project' },
  { scope: 'user', title: 'Your skills' },
];

interface QuickAccessSkillsEditorProps {
  skills: QuickAccessSkill[];
  providers: ProviderInfo[];
  discovered: ProjectSkill[];
  discoveryReady: boolean;
  onChange: (skills: QuickAccessSkill[]) => void;
  onAnnounce: (message: string) => void;
  title?: string;
  addLabel?: string;
  /**
   * What one row is called in its field labels. Combos pass something carrying
   * their own position, because two editors on one screen naming their rows
   * "Skill 1" would leave a screen reader unable to tell the fields apart.
   */
  itemNoun?: string;
  addTestId?: string;
  /**
   * The browsable list of what is on disk. Off inside a combo: the prompt field
   * completes from the same catalogue, and repeating the full list under every
   * combo buries the steps it is meant to help with.
   */
  showDiscovery?: boolean;
}

/**
 * Maintains a project's launch presets. Everything beyond a name and a prompt
 * sits behind a disclosure, so the common row stays one scannable line.
 */
export function QuickAccessSkillsEditor({
  skills,
  providers,
  discovered,
  discoveryReady,
  onChange,
  onAnnounce,
  title = 'Skills',
  addLabel = 'Add skill',
  itemNoun = 'Skill',
  addTestId = 'quick-access-add-skill',
  showDiscovery = true,
}: QuickAccessSkillsEditorProps) {
  // skill.id is both the React key and the focus token, so no parallel key
  // array is needed to survive reordering.
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const labelRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (!focusRequest) return;
    labelRefs.current.get(focusRequest.id)?.focus();
  }, [focusRequest]);

  const update = (index: number, patch: Partial<QuickAccessSkill>) =>
    onChange(skills.map((skill, i) => (i === index ? { ...skill, ...patch } : skill)));

  const addSkill = () => {
    const skill: QuickAccessSkill = { id: crypto.randomUUID(), label: '', prompt: '' };
    onChange([...skills, skill]);
    setFocusRequest({ id: skill.id, nonce: skills.length });
    onAnnounce(`Added ${itemNoun.toLowerCase()} ${skills.length + 1}`);
  };

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= skills.length) return;
    const next = [...skills];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    setFocusRequest({ id: next[target].id, nonce: target });
    onAnnounce(`Moved ${next[target].label || itemNoun.toLowerCase()} to position ${target + 1}`);
  };

  const remove = (index: number) => {
    const removed = skills[index];
    const next = skills.filter((_, i) => i !== index);
    onChange(next);
    const survivor = next[Math.min(index, next.length - 1)];
    if (survivor) setFocusRequest({ id: survivor.id, nonce: index });
    onAnnounce(`Removed ${removed.label || itemNoun.toLowerCase()}`);
  };

  const adopted = new Set(skills.map((skill) => skill.invocation).filter(Boolean));

  const adopt = (found: ProjectSkill) => {
    onChange([
      ...skills,
      {
        id: crypto.randomUUID(),
        label: found.name,
        prompt: found.invocation,
        invocation: found.invocation,
      },
    ]);
    onAnnounce(`Added ${found.name}`);
  };

  const multipleSources = new Set(discovered.map((entry) => entry.sourceId)).size > 1;

  return (
    <SettingsSection title={title} icon="auto_awesome">
      <ul aria-label={title} className="flex flex-col gap-2">
        {skills.map((skill, index) => {
          const provider = providers.find((p) => p.id === skill.providerId);
          const name = skill.label || `${itemNoun.toLowerCase()} ${index + 1}`;
          return (
            <li
              key={skill.id}
              data-testid={`quick-access-skill-${skill.id}`}
              className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
            >
              <div className="flex items-center gap-2">
                <input
                  ref={(element) => {
                    if (element) labelRefs.current.set(skill.id, element);
                    else labelRefs.current.delete(skill.id);
                  }}
                  value={skill.label}
                  aria-label={`${itemNoun} ${index + 1} name`}
                  placeholder="What to call it"
                  onChange={(event) => update(index, { label: event.target.value })}
                  className={INPUT_CLASS}
                />
                <SkillInvocationInput
                  value={skill.prompt}
                  discovered={discovered}
                  ariaLabel={`${itemNoun} ${index + 1} prompt`}
                  placeholder="Type / for a skill, or write a prompt"
                  className={`w-full ${INPUT_CLASS} font-mono`}
                  onChange={(prompt) =>
                    update(index, {
                      prompt,
                      // A hand-edited prompt is no longer the skill that was
                      // picked, and the list on disk must stop calling it added.
                      invocation: prompt === skill.invocation ? skill.invocation : undefined,
                    })
                  }
                  onPick={(found) =>
                    update(index, {
                      prompt: found.invocation,
                      invocation: found.invocation,
                      // Only when the row is still unnamed: a name someone
                      // typed is a decision, not a gap to fill.
                      label: skill.label.trim() ? skill.label : found.name,
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`Move ${name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="rounded p-1 text-foreground-muted transition-colors hover:text-foreground disabled:opacity-30"
                >
                  <AuricIcon name="arrow_upward" aria-hidden="true" className="text-[14px]" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${name} down`}
                  disabled={index === skills.length - 1}
                  onClick={() => move(index, 1)}
                  className="rounded p-1 text-foreground-muted transition-colors hover:text-foreground disabled:opacity-30"
                >
                  <AuricIcon name="arrow_downward" aria-hidden="true" className="text-[14px]" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => remove(index)}
                  className="rounded p-1 text-red-400/80 transition-colors hover:text-red-400"
                >
                  <AuricIcon name="delete" aria-hidden="true" className="text-[14px]" />
                </button>
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-foreground-muted">
                  Launch options
                  {provider ? ` — ${provider.name}` : ''}
                </summary>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <select
                    aria-label={`${itemNoun} ${index + 1} provider`}
                    value={skill.providerId ?? ''}
                    onChange={(event) =>
                      // Clearing model and permission is deliberate: carrying a
                      // Claude model id over to Crush only produces a preset
                      // that degrades again at launch time.
                      update(index, {
                        providerId: event.target.value || undefined,
                        model: undefined,
                        permissionMode: undefined,
                      })
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="">Default provider</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`${itemNoun} ${index + 1} model`}
                    value={skill.model ?? ''}
                    disabled={!provider}
                    onChange={(event) => update(index, { model: event.target.value || undefined })}
                    className={SELECT_CLASS}
                  >
                    <option value="">Provider default</option>
                    {provider?.models.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`${itemNoun} ${index + 1} permission mode`}
                    value={skill.permissionMode ?? ''}
                    disabled={!provider}
                    onChange={(event) =>
                      update(index, {
                        permissionMode: (event.target.value || undefined) as
                          PermissionMode | undefined,
                      })
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="">Provider default</option>
                    {provider?.permissionModes.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </div>
              </details>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        data-testid={addTestId}
        onClick={addSkill}
        className="flex items-center gap-1.5 rounded bg-white/5 px-3 py-1.5 text-[11px] text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
      >
        <AuricIcon name="add" aria-hidden="true" className="text-[14px]" />
        {addLabel}
      </button>

      {showDiscovery && (
        <details data-testid="quick-access-discovery">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-foreground-muted">
            Found on disk ({discovered.length})
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            {SCOPE_ORDER.map(({ scope, title }) => {
              const entries = discovered.filter((entry) => entry.scope === scope);
              if (entries.length === 0) return null;
              return (
                <div key={scope} data-testid={`quick-access-discovery-${scope}`}>
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-foreground-muted/50">
                    {title} ({entries.length})
                  </p>
                  <ul className="flex flex-col gap-1">
                    {entries.map((entry) => {
                      const alreadyAdded = adopted.has(entry.invocation);
                      return (
                        <li
                          key={`${entry.sourceId}:${entry.path}`}
                          className="flex items-center gap-2 rounded border border-white/5 px-2 py-1.5"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] text-foreground">
                              {entry.name}
                              {multipleSources && (
                                <span className="ml-1.5 text-[9px] text-foreground-muted/60">
                                  {entry.sourceId}
                                </span>
                              )}
                            </span>
                            <span
                              title={entry.description ?? undefined}
                              className="block truncate font-mono text-[10px] text-foreground-muted"
                            >
                              {entry.invocation}
                            </span>
                          </span>
                          <button
                            type="button"
                            disabled={alreadyAdded}
                            aria-label={alreadyAdded ? `${entry.name} added` : `Add ${entry.name}`}
                            onClick={() => adopt(entry)}
                            className="rounded bg-white/5 px-2 py-1 text-[10px] text-foreground-muted transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {alreadyAdded ? 'Added' : 'Add'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {discoveryReady && discovered.length === 0 && (
              <p className="text-[10px] text-foreground-muted/70">
                Nothing found. Settings → Agent → Skill discovery controls where to look.
              </p>
            )}
          </div>
        </details>
      )}
    </SettingsSection>
  );
}
