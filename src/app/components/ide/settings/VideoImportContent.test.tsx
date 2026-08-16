import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preflight, PreflightCheck } from '@/lib/tauri/videoImport';

const dbGet = vi.fn(async () => null);
const dbSet = vi.fn(async () => undefined);
const getVideoImportPreflight = vi.fn();
const installLocalParakeet = vi.fn();
const listen = vi.fn(async () => () => undefined);

vi.mock('@/lib/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ rootPath: '/tmp/project' }),
}));

vi.mock('@/lib/tauri/db', () => ({
  dbGet: (...a: unknown[]) => dbGet(...(a as [])),
  dbSet: (...a: unknown[]) => dbSet(...(a as [])),
}));

vi.mock('@/lib/tauri/videoImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/videoImport')>();
  return {
    ...actual,
    getVideoImportPreflight: () => getVideoImportPreflight(),
    installLocalParakeet: () => installLocalParakeet(),
  };
});

vi.mock('@tauri-apps/api/event', () => ({ listen: (...a: unknown[]) => listen(...(a as [])) }));

import { VideoImportContent } from './VideoImportContent';

const check = (over: Partial<PreflightCheck> = {}): PreflightCheck => ({
  id: 'uv',
  label: 'uv',
  ok: true,
  found: '0.9.2',
  requirement: 'uv 0.5.0 or newer',
  detail: 'Supported.',
  fix: null,
  ...over,
});

const preflight = (over: Partial<Preflight> = {}): Preflight => ({
  ready: true,
  canInstall: true,
  checks: [check()],
  runtimeDir: '/data/runtime',
  executable: '/data/runtime/bin/parakeet-mlx',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  dbGet.mockResolvedValue(null);
  getVideoImportPreflight.mockResolvedValue(preflight());
});

describe('VideoImportContent preflight', () => {
  it('reports each dependency with what it found', async () => {
    getVideoImportPreflight.mockResolvedValue(
      preflight({
        checks: [
          check(),
          check({ id: 'ffmpeg', label: 'ffmpeg', found: '/opt/homebrew/bin/ffmpeg' }),
        ],
      })
    );
    render(<VideoImportContent />);
    expect(await screen.findByText('uv')).toBeInTheDocument();
    expect(screen.getByText('ffmpeg')).toBeInTheDocument();
    expect(screen.getByText('/opt/homebrew/bin/ffmpeg')).toBeInTheDocument();
  });

  /// The whole point of checking first: say which dependency is wrong,
  /// in a sentence, instead of failing later with tool output.
  it('names the blocking dependency and its fix, and refuses to offer Setup', async () => {
    getVideoImportPreflight.mockResolvedValue(
      preflight({
        ready: false,
        canInstall: false,
        checks: [
          check({
            id: 'uv',
            ok: false,
            found: '0.4.2',
            detail: 'This uv is older than the version this integration is written against.',
            fix: 'uv self update',
          }),
          check({ id: 'runtime', label: 'Local Parakeet', ok: false, found: null }),
        ],
      })
    );
    render(<VideoImportContent />);
    expect(
      await screen.findByText(/older than the version this integration is written against/)
    ).toBeInTheDocument();
    expect(screen.getByText('uv self update')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Install/ })).not.toBeInTheDocument();
  });

  it('offers Setup when only the runtime itself is missing', async () => {
    getVideoImportPreflight.mockResolvedValue(
      preflight({
        ready: false,
        canInstall: true,
        checks: [
          check(),
          check({ id: 'runtime', label: 'Local Parakeet', ok: false, found: null }),
        ],
      })
    );
    render(<VideoImportContent />);
    expect(await screen.findByRole('button', { name: /^Install/ })).toBeEnabled();
  });

  it('hides Setup once the runtime is ready', async () => {
    render(<VideoImportContent />);
    await screen.findByText('uv');
    expect(screen.queryByRole('button', { name: /^Install/ })).not.toBeInTheDocument();
  });

  /// A failed install must not put the installer's output on screen.
  it('renders a failed install as a sentence with the output folded away', async () => {
    getVideoImportPreflight.mockResolvedValue(
      preflight({
        ready: false,
        canInstall: true,
        checks: [check({ id: 'runtime', label: 'Local Parakeet', ok: false, found: null })],
      })
    );
    installLocalParakeet.mockRejectedValue(
      JSON.stringify({
        summary: 'The download failed. Check the network connection and try again.',
        details: 'Traceback (most recent call last):\n  File "/x.py", line 1\nOSError: boom',
        logPath: '/data/runtime/setup.log',
      })
    );
    render(<VideoImportContent />);
    await userEvent.click(await screen.findByRole('button', { name: /^Install/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The download failed.');
    expect(alert.textContent).not.toContain('Traceback');
    expect(screen.getByText('Technical details')).toBeInTheDocument();
    expect(screen.getByText(/setup\.log/)).toBeInTheDocument();
  });

  it('re-checks on demand', async () => {
    render(<VideoImportContent />);
    await screen.findByText('uv');
    getVideoImportPreflight.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /Check again/i }));
    await waitFor(() => expect(getVideoImportPreflight).toHaveBeenCalled());
  });

  it('subscribes to setup progress so a long install is visibly working', async () => {
    render(<VideoImportContent />);
    await screen.findByText('uv');
    await waitFor(() =>
      expect(listen).toHaveBeenCalledWith('video-import-setup-progress', expect.any(Function))
    );
  });
});
