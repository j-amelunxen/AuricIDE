'use client';

import { useState } from 'react';
import { loadAppConfig, setAppConfigValue } from '@/lib/config/appConfig';
import { FORMAT_LANGUAGES } from '@/lib/editor/format/formatLanguages';
import {
  loadFormatLanguageSwitches,
  setFormatLanguageEnabled,
} from '@/lib/editor/format/formatOnSave';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsToggle } from '../../ui/settings/SettingsToggle';

export function FormattingSettings() {
  const [formatOnSave, setFormatOnSave] = useState(() => loadAppConfig().formatOnSave);
  const [formatOnBlur, setFormatOnBlur] = useState(() => loadAppConfig().formatOnBlur);
  const [languages, setLanguages] = useState(loadFormatLanguageSwitches);
  const anyTrigger = formatOnSave || formatOnBlur;

  return (
    <SettingsSection title="Formatting" icon="auto_fix_high">
      <p className="text-[10px] text-foreground-muted">
        Uses the project&apos;s own formatter (biome or prettier from node_modules, ruff or black,
        gofmt, rustfmt, shfmt). If none is installed or it fails, the file is saved as typed and you
        get a short notice. Typing never formats; autosave stays as it is.
      </p>
      <SettingsToggle
        label="Format on save"
        description="When you press ⌘S in the editor"
        checked={formatOnSave}
        onChange={(checked) => {
          setFormatOnSave(checked);
          setAppConfigValue('formatOnSave', checked);
        }}
        testId="format-on-save-toggle"
      />
      <SettingsToggle
        label="Format when the editor loses focus"
        description="Formats and saves when you click or switch away from the file"
        checked={formatOnBlur}
        onChange={(checked) => {
          setFormatOnBlur(checked);
          setAppConfigValue('formatOnBlur', checked);
        }}
        testId="format-on-blur-toggle"
      />
      <fieldset
        className={`space-y-2 pt-1 ${anyTrigger ? '' : 'opacity-50'}`}
        aria-describedby={anyTrigger ? undefined : 'format-languages-off'}
      >
        <legend className="text-[10px] uppercase tracking-wider text-foreground-muted pb-1">
          Languages
        </legend>
        {!anyTrigger && (
          <p id="format-languages-off" className="text-[10px] text-foreground-muted">
            Formatting is off. Turn on one of the switches above to use these.
          </p>
        )}
        {FORMAT_LANGUAGES.map((language) => (
          <SettingsToggle
            key={language.id}
            label={language.label}
            description={language.formatters}
            checked={languages[language.id]}
            onChange={(checked) => {
              setLanguages((current) => ({ ...current, [language.id]: checked }));
              setFormatLanguageEnabled(language.id, checked);
            }}
            testId={`format-language-${language.id}`}
          />
        ))}
      </fieldset>
    </SettingsSection>
  );
}
