'use client';

import { SettingsSection } from '../../ui/settings/SettingsSection';

export function AppearanceContent() {
  return (
    <div className="space-y-4">
      <SettingsSection title="Interface Architecture" icon="palette" className="opacity-50">
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
