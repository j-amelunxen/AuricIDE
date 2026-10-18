'use client';

import { useState } from 'react';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { SettingsToggle } from '@/app/components/ui/settings/SettingsToggle';
import {
  readMenuBarPrefs,
  writeMenuBarPrefs,
  type MenuBarPrefs,
} from '@/lib/quickAccess/supervisorMenuBar';

/**
 * The supervisor outside the window: an icon in the macOS menu bar that lists
 * its Quick Access skills, and their shortcuts working from any app. Both
 * apply at once — they are switches on this machine, not part of the policy
 * the supervisor save bar writes.
 */
export function SupervisorMenuBarSettings() {
  const [prefs, setPrefs] = useState<MenuBarPrefs>(readMenuBarPrefs);
  const change = (patch: Partial<MenuBarPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeMenuBarPrefs(next);
  };

  return (
    <SettingsSection title="Menu bar" icon="keyboard_command_key">
      <SettingsToggle
        label="Show the supervisor in the menu bar"
        description="An icon at the top of the screen lists the supervisor's Quick Access skills. A click starts one, or sends it to the supervisor already running."
        checked={prefs.tray}
        onChange={(tray) => change({ tray })}
        testId="supervisor-menu-bar-toggle"
      />
      <SettingsToggle
        label="Global shortcuts for supervisor skills"
        description="The shortcuts set on the supervisor tile's skills (Quick Access Settings → Launch options) work while another app is in front. Applies immediately."
        checked={prefs.shortcuts}
        onChange={(shortcuts) => change({ shortcuts })}
        testId="supervisor-global-shortcuts-toggle"
      />
    </SettingsSection>
  );
}
