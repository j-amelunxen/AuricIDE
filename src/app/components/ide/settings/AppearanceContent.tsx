'use client';

import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsToggle } from '../../ui/settings/SettingsToggle';
import { useTheme } from '@/lib/theme/catalog/useTheme';
import { useAttribution } from '@/lib/settings/attribution';
import type { ThemeMeta } from '@/lib/theme/catalog/types';

function ThemeOption({
  option,
  selected,
  onSelect,
}: {
  option: ThemeMeta;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <label
      className={`group flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-150 ${
        selected
          ? 'border-primary/50 bg-primary/10'
          : 'border-white/5 hover:border-white/15 hover:bg-white/5'
      }`}
    >
      <input
        type="radio"
        name="theme-picker"
        value={option.id}
        checked={selected}
        onChange={() => onSelect(option.id)}
        aria-label={option.name}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`h-4 w-4 flex-shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-[#0a0a10] transition-shadow ${
          selected ? 'ring-white/70' : 'ring-transparent'
        }`}
        style={{
          backgroundColor: option.swatch,
          boxShadow: selected ? `0 0 10px ${option.swatch}` : 'none',
        }}
      />
      <span
        className={`text-xs font-medium ${
          selected ? 'text-foreground' : 'text-foreground-muted group-hover:text-foreground'
        }`}
      >
        {option.name}
      </span>
    </label>
  );
}

export function AppearanceContent() {
  const { id, list, skippedCount, select, reload } = useTheme();
  const [showAttribution, setShowAttribution] = useAttribution();

  const builtins = list.filter((t) => t.builtin);
  const customs = list.filter((t) => !t.builtin);

  return (
    <div className="space-y-6">
      <SettingsSection title="Theme" icon="palette">
        <p className="text-xs text-foreground-muted leading-relaxed">
          Pick a look for highlights, buttons, and glows. Built-ins ship with the app; drop a JSON
          file into the <code className="text-foreground/80">themes/</code> folder for custom
          themes. Applies instantly and is remembered on this machine.
        </p>

        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {builtins.map((option) => (
            <ThemeOption
              key={option.id}
              option={option}
              selected={id === option.id}
              onSelect={select}
            />
          ))}
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
              Custom
            </span>
            <button
              type="button"
              onClick={() => void reload()}
              className="text-[10px] text-primary-light hover:underline"
              data-testid="theme-reload"
            >
              Reload themes
            </button>
          </div>

          {customs.length === 0 ? (
            <p className="text-[10px] text-foreground-muted/80 leading-relaxed">
              No custom themes yet. Add a <code className="text-foreground/70">.json</code> file to{' '}
              <code className="text-foreground/70">themes/</code> (see the folder README), then
              reload.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {customs.map((option) => (
                <ThemeOption
                  key={option.id}
                  option={option}
                  selected={id === option.id}
                  onSelect={select}
                />
              ))}
            </div>
          )}

          {skippedCount > 0 && (
            <p className="text-[10px] text-amber-400/90" data-testid="theme-skipped">
              {skippedCount} theme file{skippedCount === 1 ? '' : 's'} skipped (invalid or reserved
              id).
            </p>
          )}
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

      <SettingsSection title="Shell" icon="dashboard">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-foreground">Auric Neon</span>
            <span className="text-[9px] text-foreground-muted opacity-60">
              Dark shell is fixed for now. Themes recolor primary and optional surfaces.
            </span>
          </div>
          <div className="w-2 h-2 rounded-full bg-primary neon-glow" />
        </div>
      </SettingsSection>
    </div>
  );
}
