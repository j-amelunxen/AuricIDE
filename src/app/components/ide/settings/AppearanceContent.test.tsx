import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceContent } from './AppearanceContent';
import { ACCENTS, ACCENT_STORAGE_KEY } from '@/lib/theme/accent';
import { loadShowStatusBarClock } from '@/lib/settings/statusBarClock';
import { loadNotificationSoundEnabled, loadNotificationSoundId } from '@/lib/notifications/sound';
import { clearThemeOverrides } from '@/lib/theme/catalog/apply';
import { resetThemeForTests } from '@/lib/theme/catalog/controller';
import { THEME_STORAGE_KEY } from '@/lib/theme/catalog/storage';
import { useStore } from '@/lib/store';

const mockListThemes = vi.fn(async () => [] as { path: string; content: string }[]);
const mockImportTheme = vi.fn();
vi.mock('@/lib/tauri/themes', () => ({
  listThemes: (...args: unknown[]) => mockListThemes(...args),
  importTheme: (...args: unknown[]) => mockImportTheme(...args),
}));

const mockOpenDialog = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => mockOpenDialog(...args),
}));

const mockReadFile = vi.fn();
vi.mock('@/lib/tauri/fs', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

const mockPlayNotificationSound = vi.fn();
vi.mock('@/lib/notifications/sound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications/sound')>();
  return {
    ...actual,
    playNotificationSound: (...args: unknown[]) => mockPlayNotificationSound(...args),
  };
});

describe('AppearanceContent — theme picker', () => {
  beforeEach(() => {
    localStorage.clear();
    clearThemeOverrides();
    resetThemeForTests();
    delete document.documentElement.dataset.accent;
    delete document.documentElement.dataset.auricTheme;
    mockListThemes.mockReset();
    mockListThemes.mockResolvedValue([]);
    mockImportTheme.mockReset();
    mockOpenDialog.mockReset();
    mockReadFile.mockReset();
    useStore.setState({ toasts: [] });
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

  it('offers an import button next to reload', async () => {
    render(<AppearanceContent />);
    await waitFor(() => {
      expect(screen.getByTestId('theme-import')).toBeInTheDocument();
    });
    expect(screen.getByTestId('theme-import')).toHaveTextContent(/import/i);
  });

  it('imports a picked JSON file into the custom list', async () => {
    const user = userEvent.setup();
    const json = JSON.stringify({
      schemaVersion: 1,
      id: 'rose',
      name: 'Rose',
      swatch: '#ff4d6d',
      tokens: { primary: '#ff4d6d' },
    });
    mockOpenDialog.mockResolvedValueOnce('/tmp/rose.json');
    mockReadFile.mockResolvedValueOnce(json);
    mockImportTheme.mockImplementation(async (content: string) => {
      mockListThemes.mockResolvedValue([{ path: '/app/themes/rose.json', content }]);
      return { path: '/app/themes/rose.json', content };
    });

    render(<AppearanceContent />);
    await waitFor(() => {
      expect(screen.getByTestId('theme-import')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('theme-import'));

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Rose' })).toBeInTheDocument();
    });
    expect(mockImportTheme).toHaveBeenCalledWith(json, 'rose.json');
    expect(screen.getByRole('radio', { name: 'Rose' })).toBeChecked();
    expect(useStore.getState().toasts.some((t) => /imported theme "rose"/i.test(t.message))).toBe(
      true
    );
  });

  it('does nothing when the file picker is cancelled', async () => {
    const user = userEvent.setup();
    mockOpenDialog.mockResolvedValueOnce(null);

    render(<AppearanceContent />);
    await waitFor(() => {
      expect(screen.getByTestId('theme-import')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('theme-import'));

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockImportTheme).not.toHaveBeenCalled();
  });

  it('toasts when the picked file is not a valid theme', async () => {
    const user = userEvent.setup();
    mockOpenDialog.mockResolvedValueOnce('/tmp/bad.json');
    mockReadFile.mockResolvedValueOnce('{ not json');

    render(<AppearanceContent />);
    await waitFor(() => {
      expect(screen.getByTestId('theme-import')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('theme-import'));

    await waitFor(() => {
      expect(useStore.getState().toasts.some((t) => t.variant === 'error')).toBe(true);
    });
    expect(mockImportTheme).not.toHaveBeenCalled();
  });
});

describe('AppearanceContent — no attribution', () => {
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

  it('does not offer an attribution toggle', async () => {
    render(<AppearanceContent />);
    await waitFor(() => {
      expect(screen.getByTestId('status-bar-clock-toggle')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('attribution-toggle')).not.toBeInTheDocument();
    expect(screen.queryByText(/software-architecture\.ai/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/attribution/i)).not.toBeInTheDocument();
  });
});

describe('AppearanceContent — status bar clock toggle', () => {
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

  it('renders the status bar clock toggle switched on by default', async () => {
    render(<AppearanceContent />);
    await waitFor(() => {
      expect(screen.getByTestId('status-bar-clock-toggle')).toBeChecked();
    });
  });

  it('persists the status bar clock setting when toggled off', async () => {
    const user = userEvent.setup();
    render(<AppearanceContent />);

    await waitFor(() => {
      expect(screen.getByTestId('status-bar-clock-toggle')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('status-bar-clock-toggle'));

    expect(screen.getByTestId('status-bar-clock-toggle')).not.toBeChecked();
    expect(loadShowStatusBarClock()).toBe(false);
  });
});

describe('AppearanceContent — notification sound', () => {
  beforeEach(() => {
    localStorage.clear();
    clearThemeOverrides();
    resetThemeForTests();
    mockPlayNotificationSound.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
    clearThemeOverrides();
    resetThemeForTests();
  });

  it('renders the sound toggle off by default', async () => {
    render(<AppearanceContent />);
    await waitFor(() => {
      expect(screen.getByTestId('notification-sound-toggle')).not.toBeChecked();
    });
  });

  it('persists the sound setting when toggled on', async () => {
    const user = userEvent.setup();
    render(<AppearanceContent />);

    await waitFor(() => {
      expect(screen.getByTestId('notification-sound-toggle')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('notification-sound-toggle'));

    expect(screen.getByTestId('notification-sound-toggle')).toBeChecked();
    expect(loadNotificationSoundEnabled()).toBe(true);
  });

  it('lets you pick a sound and preview it', async () => {
    const user = userEvent.setup();
    render(<AppearanceContent />);

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Glass' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('radio', { name: 'Glass' }));
    expect(loadNotificationSoundId()).toBe('glass');

    await user.click(screen.getByTestId('notification-sound-preview'));
    expect(mockPlayNotificationSound).toHaveBeenCalledWith('glass');
  });
});
