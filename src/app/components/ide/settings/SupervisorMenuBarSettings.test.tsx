import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { readMenuBarPrefs } from '@/lib/quickAccess/supervisorMenuBar';
import { SupervisorMenuBarSettings } from './SupervisorMenuBarSettings';

describe('SupervisorMenuBarSettings', () => {
  beforeEach(() => localStorage.clear());

  it('starts with both switches off and writes each one as it is flipped', () => {
    render(<SupervisorMenuBarSettings />);
    expect(readMenuBarPrefs()).toEqual({ tray: false, shortcuts: false });

    fireEvent.click(screen.getByTestId('supervisor-menu-bar-toggle'));
    expect(readMenuBarPrefs()).toEqual({ tray: true, shortcuts: false });

    fireEvent.click(screen.getByTestId('supervisor-global-shortcuts-toggle'));
    expect(readMenuBarPrefs()).toEqual({ tray: true, shortcuts: true });
  });
});
