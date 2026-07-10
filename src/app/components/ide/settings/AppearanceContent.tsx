'use client';

import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsToggle } from '../../ui/settings/SettingsToggle';
import { ACCENTS } from '@/lib/theme/accent';
import { useAccent } from '@/lib/theme/useAccent';
import { useAttribution } from '@/lib/settings/attribution';

export function AppearanceContent() {
  const [accent, selectAccent] = useAccent();
  const [showAttribution, setShowAttribution] = useAttribution();

  return (
    <div className="space-y-6">
      <SettingsSection title="Accent Color" icon="palette">
        <p className="text-xs text-foreground-muted leading-relaxed">
          Set the primary color used across highlights, buttons, and glows. Applies instantly and is
          remembered on this machine.
        </p>
        <div
          role="radiogroup"
          aria-label="Accent color"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
          {ACCENTS.map((option) => {
            const isSelected = accent === option.id;
            return (
              <label
                key={option.id}
                className={`group flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-150 ${
                  isSelected
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-white/5 hover:border-white/15 hover:bg-white/5'
                }`}
              >
                <input
                  type="radio"
                  name="accent-color"
                  value={option.id}
                  checked={isSelected}
                  onChange={() => selectAccent(option.id)}
                  aria-label={option.label}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`h-4 w-4 flex-shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-[#0a0a10] transition-shadow ${
                    isSelected ? 'ring-white/70' : 'ring-transparent'
                  }`}
                  style={{
                    backgroundColor: option.swatch,
                    boxShadow: isSelected ? `0 0 10px ${option.swatch}` : 'none',
                  }}
                />
                <span
                  className={`text-xs font-medium ${
                    isSelected
                      ? 'text-foreground'
                      : 'text-foreground-muted group-hover:text-foreground'
                  }`}
                >
                  {option.label}
                </span>
              </label>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Attribution" icon="favorite">
        <SettingsToggle
          label="Show attribution"
          description={'Show "Made with ♥ by software-architecture.ai" in the status bar.'}
          checked={showAttribution}
          onChange={setShowAttribution}
          testId="attribution-toggle"
        />
      </SettingsSection>

      <SettingsSection title="Interface Architecture" icon="dashboard" className="opacity-50">
        <div className="flex items-center justify-between group opacity-100">
          <span className="text-xs text-foreground">Auric Neon (Active)</span>
          <div className="w-2 h-2 rounded-full bg-primary neon-glow"></div>
        </div>
        <div className="flex items-center justify-between opacity-30">
          <span className="text-xs text-foreground">Legacy Console</span>
          <div className="w-2 h-2 rounded-full bg-foreground-muted"></div>
        </div>
      </SettingsSection>
    </div>
  );
}
