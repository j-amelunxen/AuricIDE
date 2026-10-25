'use client';

import { useState } from 'react';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import {
  SETTINGS_HINT_CLASS,
  SETTINGS_LABEL_CLASS,
} from '@/app/components/ui/settings/SettingsGroup';
import type { ProviderInfo } from '@/lib/tauri/providers';

export interface SupervisorInstructionsEditorProps {
  candidates: string[];
  providers: ProviderInfo[];
  instructions: Record<string, string>;
  onChange: (instructions: Record<string, string>) => void;
}

export function SupervisorInstructionsEditor({
  candidates,
  providers,
  instructions,
  onChange,
}: SupervisorInstructionsEditorProps) {
  const activeCandidates = candidates.length > 0 ? candidates : ['claude'];
  const [selectedTab, setSelectedTab] = useState<string>(activeCandidates[0]);
  const activeTab = activeCandidates.includes(selectedTab) ? selectedTab : activeCandidates[0];
  const activeProvider = providers.find((p) => p.id === activeTab);
  const activeName = activeProvider?.name ?? activeTab;

  return (
    <SettingsSection title="Instructions" icon="edit_note">
      <div className="space-y-3">
        <p id="supervisor-instructions-hint" className={SETTINGS_HINT_CLASS}>
          Added to the supervisor&apos;s start prompt, after its built-in rules. Where they differ,
          yours win; they cannot widen what the limits on these pages allow. Each provider has its
          own.
        </p>

        {activeCandidates.length > 1 && (
          <div className="flex items-center gap-1 border-b border-white/10 pb-2">
            {activeCandidates.map((id) => {
              const provider = providers.find((p) => p.id === id);
              const label = provider?.name ?? id;
              const isActive = id === activeTab;
              const hasText = Boolean(instructions[id]?.trim());
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`supervisor-instructions-tab-${id}`}
                  onClick={() => setSelectedTab(id)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'text-foreground-muted hover:text-foreground hover:bg-white/5'
                  }`}
                >
                  <span>{label}</span>
                  {hasText && (
                    <span
                      title="Has instructions"
                      className="inline-block h-1.5 w-1.5 rounded-full bg-primary"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div>
          <label
            htmlFor={`supervisor-instructions-${activeTab}`}
            className={`mb-1 block ${SETTINGS_LABEL_CLASS}`}
          >
            Instructions for {activeName}
          </label>
          <textarea
            aria-describedby="supervisor-instructions-hint"
            id={`supervisor-instructions-${activeTab}`}
            data-testid="supervisor-instructions"
            value={instructions[activeTab] ?? ''}
            onChange={(e) =>
              onChange({
                ...instructions,
                [activeTab]: e.target.value,
              })
            }
            rows={6}
            placeholder={`e.g. Instructions specific to ${activeName}...`}
            className="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none"
          />
        </div>
      </div>
    </SettingsSection>
  );
}
