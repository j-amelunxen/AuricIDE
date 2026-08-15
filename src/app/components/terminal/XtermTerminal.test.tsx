import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Capture the attachCustomKeyEventHandler callback
let keyEventHandler: ((event: KeyboardEvent) => boolean) | null = null;
let resizeHandler: ((size: { rows: number; cols: number }) => void) | null = null;

const mockTerminalOptions: unknown[] = [];
const mockGetSelection = vi.fn().mockReturnValue('');
const mockHasSelection = vi.fn().mockReturnValue(false);
const mockSelectAll = vi.fn();
const mockPaste = vi.fn();
const mockFocus = vi.fn();

const mockTerminal = {
  options: {} as { fontSize?: number },
  loadAddon: vi.fn(),
  open: vi.fn(),
  onData: vi.fn(),
  write: vi.fn(),
  dispose: vi.fn(),
  rows: 24,
  cols: 80,
  resize: vi.fn((cols: number, rows: number) => {
    mockTerminal.cols = cols;
    mockTerminal.rows = rows;
  }),
  reset: vi.fn(),
  focus: () => mockFocus(),
  getSelection: () => mockGetSelection(),
  hasSelection: () => mockHasSelection(),
  selectAll: () => mockSelectAll(),
  paste: (text: string) => mockPaste(text),
  attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
    keyEventHandler = handler;
  }),
  onResize: vi.fn((handler: (size: { rows: number; cols: number }) => void) => {
    resizeHandler = handler;
  }),
};

vi.mock('@xterm/xterm', () => ({
  Terminal: function (options?: unknown) {
    mockTerminalOptions.push(options);
    return mockTerminal;
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: function () {
    return { fit: vi.fn() };
  },
}));

const mockWriteToShell = vi.fn().mockResolvedValue(undefined);
const mockResizeShell = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/tauri/terminal', () => ({
  spawnShell: vi.fn().mockResolvedValue(undefined),
  writeToShell: (...args: unknown[]) => mockWriteToShell(...args),
  resizeShell: (...args: unknown[]) => mockResizeShell(...args),
  onTerminalOut: vi.fn().mockResolvedValue(vi.fn()),
  onTerminalErr: vi.fn().mockResolvedValue(vi.fn()),
}));

// Capture the sendText callbacks wired into the image paste / file drop handlers
let pasteSendText: ((text: string) => void) | null = null;
let dropSendText: ((text: string) => void) | null = null;
const mockDetachImagePaste = vi.fn();
const mockDetachFileDrop = vi.fn();
const mockAttachImagePaste = vi.fn((_c: HTMLElement, sendText: (text: string) => void) => {
  pasteSendText = sendText;
  return mockDetachImagePaste;
});
// The drop handler's "a path was inserted" callback — fired below the way a
// real drop would fire it.
let dropInsertNotify: (() => void) | null = null;
const mockAttachFileDrop = vi.fn(
  (_c: HTMLElement, sendText: (text: string) => void, onInsert?: () => void) => {
    dropSendText = sendText;
    dropInsertNotify = onInsert ?? null;
    return mockDetachFileDrop;
  }
);

vi.mock('@/lib/terminal/imageInsert', () => ({
  attachImagePaste: (container: HTMLElement, sendText: (text: string) => void) =>
    mockAttachImagePaste(container, sendText),
  attachFileDrop: (
    container: HTMLElement,
    sendText: (text: string) => void,
    _onDragState?: (inside: boolean) => void,
    onInsert?: () => void
  ) => mockAttachFileDrop(container, sendText, onInsert),
}));

// Agent-mode collaborators: stream attach + PTY resize notifications
const mockDetachAgentStream = vi.fn();
const mockAttachAgentStream = vi.fn((..._args: unknown[]) => ({
  detach: mockDetachAgentStream,
  restored: Promise.resolve(),
}));
vi.mock('@/lib/terminal/agentStream', () => ({
  attachAgentStream: (...args: unknown[]) => mockAttachAgentStream(...args),
}));

let ptyResizeCb: ((size: { rows: number; cols: number }) => void) | null = null;
const mockUnsubPtyResize = vi.fn();
const mockOnAgentPtyResize = vi.fn(
  (_agentId: string, cb: (size: { rows: number; cols: number }) => void) => {
    ptyResizeCb = cb;
    return mockUnsubPtyResize;
  }
);
vi.mock('@/lib/terminal/agentMirror', () => ({
  onAgentPtyResize: (agentId: string, cb: (size: { rows: number; cols: number }) => void) =>
    mockOnAgentPtyResize(agentId, cb),
}));

vi.mock('@/lib/tauri/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/providers')>();
  return {
    ...actual,
    getPromptTemplate: vi.fn().mockRejectedValue(new Error('browser mode')),
  };
});

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(0);
  return 0;
});

Object.defineProperty(document, 'fonts', {
  value: { ready: Promise.resolve() },
  configurable: true,
});

import { XtermTerminal } from './XtermTerminal';

describe('XtermTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keyEventHandler = null;
    resizeHandler = null;
    pasteSendText = null;
    dropSendText = null;
    dropInsertNotify = null;
    ptyResizeCb = null;
    mockTerminalOptions.length = 0;
    mockGetSelection.mockReturnValue('');
    mockHasSelection.mockReturnValue(false);
    mockSelectAll.mockReset();
    mockPaste.mockReset();
    mockTerminal.cols = 80;
    mockTerminal.rows = 24;
    mockTerminal.options = {};
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue('pasted line'),
      },
    });
  });

  it('registers a custom key event handler', () => {
    render(<XtermTerminal id="test-session" />);
    expect(mockTerminal.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);
    expect(keyEventHandler).toBeInstanceOf(Function);
  });

  it('CMD+I writes the prompt template from provider (fallback)', () => {
    render(<XtermTerminal id="test-session" />);
    expect(keyEventHandler).not.toBeNull();

    const event = new KeyboardEvent('keydown', { key: 'i', metaKey: true });
    const result = keyEventHandler!(event);

    expect(result).toBe(false);
    expect(mockWriteToShell).toHaveBeenCalledTimes(1);
    // In test env, getPromptTemplate rejects so fallback is used
    expect(mockWriteToShell).toHaveBeenCalledWith('test-session', 'crush "');
  });

  it('does not intercept regular keys', () => {
    render(<XtermTerminal id="test-session" />);

    const event = new KeyboardEvent('keydown', { key: 'a' });
    const result = keyEventHandler!(event);

    expect(result).toBe(true);
    expect(mockWriteToShell).not.toHaveBeenCalled();
  });

  it('does not intercept Cmd+C when nothing is selected (SIGINT still reaches the PTY)', () => {
    render(<XtermTerminal id="test-session" />);

    const event = new KeyboardEvent('keydown', { key: 'c', metaKey: true });
    const result = keyEventHandler!(event);

    expect(result).toBe(true);
  });

  it('copies on Cmd+C when there is a selection', async () => {
    mockHasSelection.mockReturnValue(true);
    mockGetSelection.mockReturnValue('picked');
    render(<XtermTerminal id="test-session" />);

    const event = new KeyboardEvent('keydown', { key: 'c', metaKey: true });
    expect(keyEventHandler!(event)).toBe(false);
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('picked'));
  });

  it('selects all on Cmd+A', () => {
    render(<XtermTerminal id="test-session" />);
    const event = new KeyboardEvent('keydown', { key: 'a', metaKey: true });
    expect(keyEventHandler!(event)).toBe(false);
    expect(mockSelectAll).toHaveBeenCalled();
  });

  it('enables Option-click selection and snappier wheel scrolling', () => {
    render(<XtermTerminal id="test-session" />);
    expect(mockTerminalOptions[0]).toEqual(
      expect.objectContaining({
        macOptionClickForcesSelection: true,
        scrollSensitivity: 3,
        smoothScrollDuration: 0,
      })
    );
  });

  it('uses the global font size for an agent terminal', () => {
    localStorage.setItem('auric.agent-terminal-font-size', '17');

    render(<XtermTerminal id="agent-a1" agentId="a1" onInput={vi.fn()} />);

    expect(mockTerminalOptions[0]).toEqual(expect.objectContaining({ fontSize: 17 }));
  });

  it('updates an already-open agent terminal when the setting changes', () => {
    render(<XtermTerminal id="agent-a1" agentId="a1" onInput={vi.fn()} />);
    localStorage.setItem('auric.agent-terminal-font-size', '18');

    window.dispatchEvent(
      new CustomEvent('auric:app-config-changed', {
        detail: { key: 'auric.agent-terminal-font-size' },
      })
    );

    expect(mockTerminal.options.fontSize).toBe(18);
  });

  it('loads only the FitAddon on open', () => {
    render(<XtermTerminal id="test-session" />);
    expect(mockTerminal.loadAddon).toHaveBeenCalledTimes(1);
    expect(mockTerminal.loadAddon).toHaveBeenCalledWith({ fit: expect.any(Function) });
  });

  it('registers an onResize handler', () => {
    render(<XtermTerminal id="test-session" />);
    expect(mockTerminal.onResize).toHaveBeenCalledTimes(1);
    expect(resizeHandler).toBeInstanceOf(Function);
  });

  it('calls resizeShell when onResize fires', () => {
    render(<XtermTerminal id="test-session" />);
    expect(resizeHandler).not.toBeNull();

    resizeHandler!({ rows: 50, cols: 120 });
    expect(mockResizeShell).toHaveBeenCalledWith('test-session', 50, 120);
  });

  describe('agent mode (bottom panel preview)', () => {
    const renderAgent = async () => {
      const utils = render(<XtermTerminal id="agent-a1" agentId="a1" onInput={vi.fn()} />);
      await vi.waitFor(() => expect(mockAttachAgentStream).toHaveBeenCalledTimes(1));
      return utils;
    };

    it('syncs the agent PTY to the fitted size before attaching the stream', async () => {
      await renderAgent();
      expect(mockResizeShell).toHaveBeenCalledWith('agent-a1', 24, 80);
      // Sync must precede the attach so the mirror snapshot is laid out for
      // the geometry this view displays at.
      expect(mockResizeShell.mock.invocationCallOrder[0]).toBeLessThan(
        mockAttachAgentStream.mock.invocationCallOrder[0]
      );
    });

    it('propagates xterm resizes to the agent PTY', async () => {
      await renderAgent();
      expect(resizeHandler).not.toBeNull();
      resizeHandler!({ rows: 8, cols: 220 });
      expect(mockResizeShell).toHaveBeenCalledWith('agent-a1', 8, 220);
    });

    it('adopts an external PTY resize by re-attaching at the new geometry', async () => {
      await renderAgent();
      expect(ptyResizeCb).not.toBeNull();

      ptyResizeCb!({ rows: 40, cols: 160 });

      expect(mockDetachAgentStream).toHaveBeenCalledTimes(1);
      expect(mockTerminal.resize).toHaveBeenCalledWith(160, 40);
      expect(mockTerminal.reset).toHaveBeenCalledTimes(1);
      expect(mockAttachAgentStream).toHaveBeenCalledTimes(2);
    });

    it('ignores external resize notifications that match the current size', async () => {
      await renderAgent();

      ptyResizeCb!({ rows: 24, cols: 80 });

      expect(mockTerminal.reset).not.toHaveBeenCalled();
      expect(mockAttachAgentStream).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes from PTY resize events and detaches on unmount', async () => {
      const { unmount } = await renderAgent();
      unmount();
      expect(mockUnsubPtyResize).toHaveBeenCalledTimes(1);
      expect(mockDetachAgentStream).toHaveBeenCalledTimes(1);
    });
  });

  describe('image paste & file drop', () => {
    it('attaches paste and drop handlers to the terminal container', () => {
      render(<XtermTerminal id="test-session" />);
      expect(mockAttachImagePaste).toHaveBeenCalledTimes(1);
      expect(mockAttachFileDrop).toHaveBeenCalledTimes(1);
      expect(mockAttachImagePaste.mock.calls[0][0]).toBeInstanceOf(HTMLElement);
      expect(mockAttachFileDrop.mock.calls[0][0]).toBeInstanceOf(HTMLElement);
    });

    it('routes pasted image paths to the shell when no onInput is given', () => {
      render(<XtermTerminal id="test-session" />);
      pasteSendText!('/cache/screenshot_1.png ');
      expect(mockWriteToShell).toHaveBeenCalledWith('test-session', '/cache/screenshot_1.png ');
    });

    it('routes pasted image paths through onInput (agent mode)', () => {
      const onInput = vi.fn();
      render(<XtermTerminal id="test-session" onInput={onInput} />);
      pasteSendText!('/cache/screenshot_1.png ');
      expect(onInput).toHaveBeenCalledWith('/cache/screenshot_1.png ');
      expect(mockWriteToShell).not.toHaveBeenCalled();
    });

    it('routes dropped file paths through onInput (agent mode)', () => {
      const onInput = vi.fn();
      render(<XtermTerminal id="test-session" onInput={onInput} />);
      dropSendText!('/Users/j/pic.png ');
      expect(onInput).toHaveBeenCalledWith('/Users/j/pic.png ');
    });

    // A native drag leaves the keyboard wherever it was, so without this the
    // path is in the prompt but Enter goes somewhere else until you click in.
    it('takes the keyboard back once a dropped path is inserted', () => {
      render(<XtermTerminal id="test-session" />);
      mockFocus.mockClear();
      dropInsertNotify!();
      expect(mockFocus).toHaveBeenCalled();
    });

    it('detaches both handlers on unmount', () => {
      const { unmount } = render(<XtermTerminal id="test-session" />);
      unmount();
      expect(mockDetachImagePaste).toHaveBeenCalledTimes(1);
      expect(mockDetachFileDrop).toHaveBeenCalledTimes(1);
    });
  });

  describe('context menu', () => {
    it('offers copy/paste/select-all on right-click when text is selected', () => {
      mockGetSelection.mockReturnValue('picked');
      const { container } = render(<XtermTerminal id="test-session" />);
      fireEvent.contextMenu(container.querySelector('[data-testid="xterm"]')!);
      expect(screen.getByText('Copy')).toBeInTheDocument();
      expect(screen.getByText('Paste')).toBeInTheDocument();
      expect(screen.getByText('Select All')).toBeInTheDocument();
    });

    it('offers paste without a selection', () => {
      const { container } = render(<XtermTerminal id="test-session" />);
      fireEvent.contextMenu(container.querySelector('[data-testid="xterm"]')!);
      expect(screen.getByText('Paste')).toBeInTheDocument();
      expect(screen.queryByText('Copy')).not.toBeInTheDocument();
    });

    it('pastes clipboard text through xterm', async () => {
      const { container } = render(<XtermTerminal id="test-session" />);
      fireEvent.contextMenu(container.querySelector('[data-testid="xterm"]')!);
      await userEvent.click(screen.getByText('Paste'));
      await vi.waitFor(() => expect(mockPaste).toHaveBeenCalledWith('pasted line'));
    });
  });
});
