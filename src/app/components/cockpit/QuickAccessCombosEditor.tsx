'use client';

import { useEffect, useRef, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import type { ProviderInfo } from '@/lib/tauri/providers';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';
import type { QuickAccessCombo, QuickAccessSkill } from '@/lib/store/starredProjectsSlice';
import { comboPreview } from '@/lib/quickAccess/combo';
import { QuickAccessSkillsEditor } from './QuickAccessSkillsEditor';
import type { AuricSkillDefinition } from '@/lib/settings/auricSkills';

interface QuickAccessCombosEditorProps {
  combos: QuickAccessCombo[];
  providers: ProviderInfo[];
  discovered: ProjectSkill[];
  auricSkills: AuricSkillDefinition[];
  discoveryReady: boolean;
  onChange: (combos: QuickAccessCombo[]) => void;
  onAnnounce: (message: string) => void;
}

function emptyCombo(): QuickAccessCombo {
  return { id: crypto.randomUUID(), label: '', steps: [] };
}

/**
 * Ordered chains of launch presets. Each combo is a name plus the same
 * step editor a lone skill uses, so a step can pin its own provider.
 */
export function QuickAccessCombosEditor({
  combos,
  providers,
  discovered,
  auricSkills,
  discoveryReady,
  onChange,
  onAnnounce,
}: QuickAccessCombosEditorProps) {
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const labelRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (!focusRequest) return;
    labelRefs.current.get(focusRequest.id)?.focus();
  }, [focusRequest]);

  const update = (index: number, patch: Partial<QuickAccessCombo>) =>
    onChange(combos.map((combo, i) => (i === index ? { ...combo, ...patch } : combo)));

  const addCombo = () => {
    const combo = emptyCombo();
    onChange([...combos, combo]);
    setFocusRequest({ id: combo.id, nonce: combos.length });
    onAnnounce(`Added combo ${combos.length + 1}`);
  };

  const remove = (index: number) => {
    const removed = combos[index];
    onChange(combos.filter((_, i) => i !== index));
    onAnnounce(`Removed ${removed.label || 'combo'}`);
  };

  return (
    <SettingsSection title="Skill Combos" icon="account_tree">
      <ul aria-label="Skill combos" className="flex flex-col gap-3">
        {combos.map((combo, index) => {
          const name = combo.label || `combo ${index + 1}`;
          const preview = comboPreview(combo);
          return (
            <li
              key={combo.id}
              data-testid={`quick-access-combo-${combo.id}`}
              className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-primary/15 text-[11px] font-bold text-primary-light"
                >
                  +
                </span>
                <input
                  ref={(element) => {
                    if (element) labelRefs.current.set(combo.id, element);
                    else labelRefs.current.delete(combo.id);
                  }}
                  value={combo.label}
                  aria-label={`Combo ${index + 1} name`}
                  placeholder="What to call the chain"
                  onChange={(event) => update(index, { label: event.target.value })}
                  className="min-w-0 flex-1 rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/40"
                />
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => remove(index)}
                  className="rounded p-1 text-red-400/80 transition-colors hover:text-red-400"
                >
                  <AuricIcon name="delete" aria-hidden="true" className="text-[14px]" />
                </button>
              </div>
              {preview && (
                <p
                  data-testid={`quick-access-combo-preview-${combo.id}`}
                  className="mt-1.5 pl-8 text-[10px] text-foreground-muted/70"
                >
                  {preview}
                </p>
              )}
              <div className="mt-3">
                <QuickAccessSkillsEditor
                  skills={combo.steps}
                  providers={providers}
                  discovered={discovered}
                  auricSkills={auricSkills}
                  discoveryReady={discoveryReady}
                  title="Steps"
                  addLabel="Add step"
                  itemNoun={`Combo ${index + 1} step`}
                  addTestId={`quick-access-add-step-${combo.id}`}
                  showDiscovery={false}
                  onChange={(steps: QuickAccessSkill[]) => update(index, { steps })}
                  onAnnounce={onAnnounce}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        data-testid="quick-access-add-combo"
        onClick={addCombo}
        className="flex items-center gap-1.5 rounded bg-white/5 px-3 py-1.5 text-[11px] text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
      >
        <AuricIcon name="add" aria-hidden="true" className="text-[14px]" />
        Add combo
      </button>
    </SettingsSection>
  );
}
