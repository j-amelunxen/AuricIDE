'use client';

import { useStore } from '@/lib/store';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsToggle } from '../../ui/settings/SettingsToggle';
import { GUIDANCE } from '@/lib/ui/descriptions';

export function EditorContent() {
  const enableDeepNlp = useStore((s) => s.enableDeepNlp);
  const setEnableDeepNlp = useStore((s) => s.setEnableDeepNlp);
  const lintEnabled = useStore((s) => s.lintConfig.enabled);

  const setLintEnabled = (enabled: boolean) => {
    useStore.setState((state) => ({
      lintConfig: { ...state.lintConfig, enabled },
    }));
  };

  return (
    <div className="space-y-4">
      <SettingsSection title="Editor" icon="edit_note">
        <SettingsToggle
          label="Deep NLP Analysis"
          description="NER + intent classification via ONNX models (~300 MB)"
          tooltip={GUIDANCE.settings.deepNlp}
          checked={enableDeepNlp}
          onChange={setEnableDeepNlp}
          testId="deep-nlp-toggle"
        />

        <SettingsToggle
          label="Markdown Linting"
          description="Inline warnings and errors via remark-lint"
          tooltip={GUIDANCE.settings.linting}
          checked={lintEnabled}
          onChange={setLintEnabled}
          testId="lint-toggle"
        />
      </SettingsSection>
    </div>
  );
}
