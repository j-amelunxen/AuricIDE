import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PerformanceMonitor } from './PerformanceMonitor';
import { destroyMetricsCollector } from '@/lib/metrics';

// Mock Tauri IPC — default: reject (browser mode)
const mockInvoke = vi.fn().mockRejectedValue(new Error('not in Tauri'));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock performance.memory (Chrome-only API)
const mockMemory = {
  usedJSHeapSize: 100 * 1024 * 1024, // 100 MB
  totalJSHeapSize: 200 * 1024 * 1024,
  jsHeapSizeLimit: 4096 * 1024 * 1024,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockInvoke.mockRejectedValue(new Error('not in Tauri'));
  Object.defineProperty(performance, 'memory', {
    value: mockMemory,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  destroyMetricsCollector();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Helper: render and wait for first collector cycle to settle
// The collector's collect() is async (dynamic import + process fetcher),
// so we need to advance timers and flush microtasks.
async function renderAndCollect() {
  render(<PerformanceMonitor />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
}

describe('PerformanceMonitor', () => {
  it('renders nothing in production mode', () => {
    const originalEnv = process.env.NODE_ENV;
    (process.env as { NODE_ENV: string }).NODE_ENV = 'production';
    const { container } = render(<PerformanceMonitor />);
    expect(container.innerHTML).toBe('');
    (process.env as { NODE_ENV: string }).NODE_ENV = originalEnv ?? 'test';
  });

  it('renders the monitor badge in development', async () => {
    await renderAndCollect();
    expect(screen.getByTestId('perf-monitor')).toBeDefined();
  });

  it('displays heap size in MB (Chrome fallback)', async () => {
    await renderAndCollect();
    // 100 MB via performance.memory (falls back to JS heap when no processes)
    expect(screen.getByTestId('perf-monitor').textContent).toContain('100');
  });

  it('shows green state for normal memory usage', async () => {
    await renderAndCollect();
    const badge = screen.getByTestId('perf-monitor');
    expect(badge.className).toContain('bg-green');
  });

  it('shows amber state for elevated memory (>500MB total)', async () => {
    mockInvoke.mockResolvedValue([
      { label: 'Tauri (Rust)', pid: 1, rss_bytes: 300 * 1024 * 1024 },
      { label: 'Next.js', pid: 2, rss_bytes: 400 * 1024 * 1024 },
    ]);
    render(<PerformanceMonitor />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    const badge = screen.getByTestId('perf-monitor');
    expect(badge.className).toContain('bg-amber');
  });

  it('shows red state for critical memory (>1500MB total)', async () => {
    mockInvoke.mockResolvedValue([
      { label: 'Tauri (Rust)', pid: 1, rss_bytes: 500 * 1024 * 1024 },
      { label: 'Next.js', pid: 2, rss_bytes: 600 * 1024 * 1024 },
      { label: 'WebView (UI)', pid: 3, rss_bytes: 600 * 1024 * 1024 },
    ]);
    render(<PerformanceMonitor />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    const badge = screen.getByTestId('perf-monitor');
    expect(badge.className).toContain('bg-red');
  });

  it('expands panel on click', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderAndCollect();
    await user.click(screen.getByTestId('perf-monitor'));
    expect(screen.getByTestId('perf-panel')).toBeDefined();
  });

  it('shows process breakdown in expanded panel (Tauri mode)', async () => {
    mockInvoke.mockResolvedValue([
      { label: 'Tauri (Rust)', pid: 100, rss_bytes: 128 * 1024 * 1024 },
      { label: 'Next.js', pid: 200, rss_bytes: 892 * 1024 * 1024 },
      { label: 'WebView (UI)', pid: 300, rss_bytes: 245 * 1024 * 1024 },
    ]);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PerformanceMonitor />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await user.click(screen.getByTestId('perf-monitor'));

    const panel = screen.getByTestId('perf-panel');
    expect(panel.textContent).toContain('Tauri (Rust)');
    expect(panel.textContent).toContain('128 MB');
    expect(panel.textContent).toContain('Next.js');
    expect(panel.textContent).toContain('892 MB');
    expect(panel.textContent).toContain('WebView (UI)');
    expect(panel.textContent).toContain('245 MB');
  });

  it('shows total in badge with multi-process data', async () => {
    mockInvoke.mockResolvedValue([
      { label: 'Tauri (Rust)', pid: 1, rss_bytes: 128 * 1024 * 1024 },
      { label: 'Next.js', pid: 2, rss_bytes: 400 * 1024 * 1024 },
    ]);
    render(<PerformanceMonitor />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    // Total = 128 + 400 = 528 MB
    expect(screen.getByTestId('perf-monitor').textContent).toContain('528');
  });

  it('shows JS Heap in expanded panel (Chrome fallback)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderAndCollect();
    await user.click(screen.getByTestId('perf-monitor'));
    const panel = screen.getByTestId('perf-panel');
    expect(panel.textContent).toContain('JS Heap');
  });

  it('gracefully handles missing performance.memory and no Tauri', async () => {
    Object.defineProperty(performance, 'memory', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    await renderAndCollect();
    expect(screen.getByTestId('perf-monitor').textContent).toContain('N/A');
  });

  it('updates memory reading periodically', async () => {
    await renderAndCollect();
    expect(screen.getByTestId('perf-monitor').textContent).toContain('100');

    // Change memory and advance timer
    Object.defineProperty(performance, 'memory', {
      value: { ...mockMemory, usedJSHeapSize: 250 * 1024 * 1024 },
      writable: true,
      configurable: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('perf-monitor').textContent).toContain('250');
  });

  it('formats large values as GB', async () => {
    mockInvoke.mockResolvedValue([
      { label: 'WebView (UI)', pid: 1, rss_bytes: 2048 * 1024 * 1024 },
    ]);
    render(<PerformanceMonitor />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('perf-monitor').textContent).toContain('GB');
  });

  it('shows Store Breakdown in expanded panel', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderAndCollect();
    await user.click(screen.getByTestId('perf-monitor'));
    const panel = screen.getByTestId('perf-panel');
    expect(panel.textContent).toContain('Store Breakdown');
    expect(panel.textContent).toContain('Terminal Logs');
    expect(panel.textContent).toContain('Agent Logs');
    expect(panel.textContent).toContain('Xterm Instances');
  });
});
