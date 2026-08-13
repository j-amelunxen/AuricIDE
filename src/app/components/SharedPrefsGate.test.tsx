import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const installPrefMirror = vi.fn(() => () => {});
const syncSharedPrefs = vi.fn(async () => {});
const applyStoredSnapshot = vi.fn();

vi.mock('@/lib/storage/sharedPrefs', () => ({
  installPrefMirror: () => installPrefMirror(),
  syncSharedPrefs: () => syncSharedPrefs(),
}));
vi.mock('@/lib/theme/catalog/apply', () => ({
  applyStoredSnapshot: () => applyStoredSnapshot(),
}));

import { PREFS_SYNC_TIMEOUT_MS, SharedPrefsGate } from './SharedPrefsGate';

/**
 * Preferences have to be reconciled before the IDE reads them, or a panel that
 * mounts in the first frames keeps the value this origin happened to hold and
 * the two builds disagree until the panel is reopened.
 */
describe('SharedPrefsGate', () => {
  beforeEach(() => {
    installPrefMirror.mockClear();
    applyStoredSnapshot.mockClear();
    syncSharedPrefs.mockReset();
    syncSharedPrefs.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders its children once the preferences are reconciled', async () => {
    render(
      <SharedPrefsGate>
        <p>IDE</p>
      </SharedPrefsGate>
    );

    expect(await screen.findByText('IDE')).toBeInTheDocument();
  });

  it('starts mirroring writes before it lets anything render', async () => {
    render(
      <SharedPrefsGate>
        <p>IDE</p>
      </SharedPrefsGate>
    );

    await screen.findByText('IDE');
    expect(installPrefMirror).toHaveBeenCalled();
  });

  /**
   * The pre-paint script already ran against the values this origin had, so
   * anything adopted afterwards has to be put back on `<html>` by hand.
   */
  it('re-applies the theme the reconciliation brought in', async () => {
    render(
      <SharedPrefsGate>
        <p>IDE</p>
      </SharedPrefsGate>
    );

    await screen.findByText('IDE');
    expect(applyStoredSnapshot).toHaveBeenCalled();
  });

  /**
   * A backend that never answers must cost the user a stale preference, not a
   * window that never fills in.
   */
  it('gives up waiting and renders anyway', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    syncSharedPrefs.mockReturnValue(new Promise(() => {}));

    render(
      <SharedPrefsGate>
        <p>IDE</p>
      </SharedPrefsGate>
    );

    expect(screen.queryByText('IDE')).not.toBeInTheDocument();
    vi.advanceTimersByTime(PREFS_SYNC_TIMEOUT_MS);

    await waitFor(() => expect(screen.getByText('IDE')).toBeInTheDocument());
  });
});
