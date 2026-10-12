import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('./invoke', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const resizeAgentMirrorMock = vi.fn();
vi.mock('../terminal/agentMirror', () => ({
  resizeAgentMirror: (...args: unknown[]) => resizeAgentMirrorMock(...args),
}));

// The seam is driven by hand: Rust's `agent-pty-resized` is whatever this is
// called with.
let ptyResized: ((payload: unknown) => void) | null = null;
const stopListening = vi.fn();
vi.mock('./agentEvents', () => ({
  onAgentPtyResized: (callback: (payload: unknown) => void) => {
    ptyResized = callback;
    return stopListening;
  },
}));

const { installPtyResizeSync, resizeShell } = await import('./terminal');

const shellResizes = () => invokeMock.mock.calls.filter(([cmd]) => cmd === 'shell_resize');

let uninstall: (() => void) | null = null;

beforeEach(() => {
  uninstall?.();
  uninstall = null;
  ptyResized = null;
  vi.clearAllMocks();
});

describe('resizeShell', () => {
  it('resizes the PTY and keeps an agent’s mirror in step', async () => {
    await resizeShell('agent-agent-1', 40, 120);

    expect(resizeAgentMirrorMock).toHaveBeenCalledWith('agent-1', 40, 120);
    expect(invokeMock).toHaveBeenCalledWith('shell_resize', {
      id: 'agent-agent-1',
      rows: 40,
      cols: 120,
    });
  });

  it('leaves mirrors alone for a plain shell', async () => {
    await resizeShell('shell-1', 40, 120);
    expect(resizeAgentMirrorMock).not.toHaveBeenCalled();
    expect(shellResizes()).toHaveLength(1);
  });
});

describe('installPtyResizeSync — geometry from the other window', () => {
  it('feeds a remote resize into the mirror and sends nothing to Rust', () => {
    uninstall = installPtyResizeSync();

    ptyResized?.({ agentId: 'agent-1', rows: 50, cols: 160 });

    expect(resizeAgentMirrorMock).toHaveBeenCalledWith('agent-1', 50, 160);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('does not send a size back that arrived this way', async () => {
    uninstall = installPtyResizeSync();
    ptyResized?.({ agentId: 'agent-1', rows: 50, cols: 160 });
    resizeAgentMirrorMock.mockClear();

    // What a view does when it adopts the size: its terminal resizes, and the
    // terminal's resize event calls this.
    await resizeShell('agent-agent-1', 50, 160);

    expect(shellResizes()).toHaveLength(0);
    expect(resizeAgentMirrorMock).toHaveBeenCalledWith('agent-1', 50, 160);
  });

  it('still sends a size this window chose itself', async () => {
    uninstall = installPtyResizeSync();
    ptyResized?.({ agentId: 'agent-1', rows: 50, cols: 160 });

    await resizeShell('agent-agent-1', 30, 100);

    expect(shellResizes()).toHaveLength(1);
  });

  it('judges by the newest size Rust reported, so an old one can be chosen again', async () => {
    uninstall = installPtyResizeSync();
    ptyResized?.({ agentId: 'agent-1', rows: 50, cols: 160 });
    ptyResized?.({ agentId: 'agent-1', rows: 30, cols: 100 });

    await resizeShell('agent-agent-1', 50, 160);

    expect(shellResizes()).toHaveLength(1);
  });

  it('keeps agents apart', async () => {
    uninstall = installPtyResizeSync();
    ptyResized?.({ agentId: 'agent-1', rows: 50, cols: 160 });

    await resizeShell('agent-agent-2', 50, 160);

    expect(shellResizes()).toHaveLength(1);
  });

  it('drops a payload that breaks the contract, naming the field', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    uninstall = installPtyResizeSync();

    ptyResized?.({ agentId: 'agent-1', rows: 0, cols: 80 });

    expect(resizeAgentMirrorMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ptyResized.rows'));
    warn.mockRestore();
  });

  it('stops listening and forgets what it heard on uninstall', async () => {
    const stop = installPtyResizeSync();
    ptyResized?.({ agentId: 'agent-1', rows: 50, cols: 160 });

    stop();
    await resizeShell('agent-agent-1', 50, 160);

    expect(stopListening).toHaveBeenCalledTimes(1);
    expect(shellResizes()).toHaveLength(1);
  });
});

describe('installPtyResizeSync — the newest known size, reported or sent', () => {
  it('sends a fit back to the reported size when another size went out in between', async () => {
    uninstall = installPtyResizeSync();
    ptyResized?.({ agentId: 'agent-1', rows: 30, cols: 100 });

    // 40x120 is on its way to Rust; its report has not come back yet.
    await resizeShell('agent-agent-1', 40, 120);
    await resizeShell('agent-agent-1', 30, 100);

    expect(shellResizes().map(([, args]) => args)).toEqual([
      { id: 'agent-agent-1', rows: 40, cols: 120 },
      { id: 'agent-agent-1', rows: 30, cols: 100 },
    ]);
  });

  it('does not send the size it sent last a second time', async () => {
    uninstall = installPtyResizeSync();
    await resizeShell('agent-agent-1', 40, 120);
    await resizeShell('agent-agent-1', 40, 120);
    expect(shellResizes()).toHaveLength(1);
  });

  it('forgets a size whose send failed, so the next fit tries again', async () => {
    uninstall = installPtyResizeSync();
    invokeMock.mockRejectedValueOnce(new Error('session gone'));
    await expect(resizeShell('agent-agent-1', 40, 120)).rejects.toThrow('session gone');

    await resizeShell('agent-agent-1', 40, 120);

    expect(shellResizes()).toHaveLength(2);
  });

  it('sends every fit while not installed: one window runs the path it always ran', async () => {
    await resizeShell('agent-agent-1', 40, 120);
    await resizeShell('agent-agent-1', 40, 120);
    expect(shellResizes()).toHaveLength(2);
  });
});
