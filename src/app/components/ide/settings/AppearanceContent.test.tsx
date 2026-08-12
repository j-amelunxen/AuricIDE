import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceContent } from './AppearanceContent';
import { ACCENTS, ACCENT_STORAGE_KEY } from '@/lib/theme/accent';
import { loadShowAttribution } from '@/lib/settings/attribution';
import { clearThemeOverrides } from '@/lib/theme/catalog/apply';
import { resetThemeForTests } from '@/lib/theme/catalog/controller';
import { THEME_STORAGE_KEY } from '@/lib/theme/catalog/storage';

vi.mock('@/lib/tauri/themes', () => ({
  listThemes: vi.fn(async () => []),
  importTheme: vi.fn(),
}));

describe('AppearanceContent — theme picker', () => {
  beforeEach(() => {
    localStorage.clear();
    clearThemeOverrides();
    resetThemeForTests();
    delete document.documentElement.dataset.accent;
    delete document.documentElement.dataset.auricTheme;
  });

  afterEach(() => {
    localStorage.clear();
    clearThemeOverrides();
    resetThemeForTests();
    delete document.documentElement.dataset.accent;
    delete document.documentElement.dataset.auricTheme;
  });

  it('renders a selectable swatch for every built-in accent', async () => {
    render(<AppearanceContent />);
    await waitFor(() => {
      for (const accent of ACCENTS) {
        expect(screen.getByRole('radio', { name: accent.label })).toBeInTheDocument();
      }
    });
  });

  it('marks the current theme as selected', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'blue');
    localStorage.setItem(ACCENT_STORAGE_KEY, 'blue');
    render(<AppearanceContent />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Electric Blue' })).toBeChecked();
    });
  });

  it('applies and persists the theme when a swatch is picked', async () => {
    const user = userEvent.setup();
    render(<AppearanceContent />);

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Electric Blue' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('radio', { name: 'Electric Blue' }));

    expect(document.documentElement.dataset.auricTheme).toBe('blue');
    expect(document.documentElement.dataset.accent).toBe('blue');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('blue');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('blue');
    expect(screen.getByRole('radio', { name: 'Electric Blue' })).toBeChecked();
  });

  it('shows custom empty state and reload control', async () => {
    render(<AppearanceContent />);
    await waitFor(() => {
      expect(screen.getByTestId('theme-reload')).toBeInTheDocument();
    });
    expect(screen.getByText(/No custom themes yet/i)).toBeInTheDocument();
  });
});

describe('AppearanceContent — attribution toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    clearThemeOverrides();
    resetThemeForTests();
  });

  afterEach(() => {
    localStorage.clear();
    clearThemeOverrides();
    resetThemeForTests();
  });

  it('renders the attribution toggle switched off by default', async () => {
    render(<AppearanceContent />);
    await waitFor(() => {
      expect(screen.getByTestId('attribution-toggle')).not.toBeChecked();
    });
  });

  it('persists the attribution setting when toggled on', async () => {
    const user = userEvent.setup();
    render(<AppearanceContent />);

    await waitFor(() => {
      expect(screen.getByTestId('attribution-toggle')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('attribution-toggle'));

    expect(screen.getByTestId('attribution-toggle')).toBeChecked();
    expect(loadShowAttribution()).toBe(true);
  });
});
