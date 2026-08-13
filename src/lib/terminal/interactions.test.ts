import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  TERMINAL_INTERACTION_OPTIONS,
  buildTerminalMenu,
  clipboardKeyAction,
  copyText,
  handleTerminalClipboardKey,
  readClipboardText,
  terminalMenuActions,
} from './interactions';

describe('TERMINAL_INTERACTION_OPTIONS', () => {
  it('forces Option-click selection on macOS even when a TUI owns the mouse', () => {
    expect(TERMINAL_INTERACTION_OPTIONS.macOptionClickForcesSelection).toBe(true);
  });

  it('does not steal right-click for word-select (we own the context menu)', () => {
    expect(TERMINAL_INTERACTION_OPTIONS.rightClickSelectsWord).toBe(false);
  });

  it('scrolls faster than xterm’s WKWebView-pixel default', () => {
    expect(TERMINAL_INTERACTION_OPTIONS.scrollSensitivity).toBeGreaterThan(1);
    expect(TERMINAL_INTERACTION_OPTIONS.smoothScrollDuration).toBe(0);
  });
});

describe('clipboardKeyAction', () => {
  it('copies on Cmd+C only when there is a selection', () => {
    const event = { type: 'keydown', key: 'c', metaKey: true, ctrlKey: false, altKey: false };
    expect(clipboardKeyAction(event, true)).toBe('copy');
    expect(clipboardKeyAction(event, false)).toBe('pass');
  });

  it('leaves Ctrl+C alone so the PTY still gets SIGINT', () => {
    const event = { type: 'keydown', key: 'c', metaKey: false, ctrlKey: true, altKey: false };
    expect(clipboardKeyAction(event, true)).toBe('pass');
  });

  it('selects all on Cmd+A', () => {
    const event = { type: 'keydown', key: 'a', metaKey: true, ctrlKey: false, altKey: false };
    expect(clipboardKeyAction(event, false)).toBe('select-all');
  });

  it('does not swallow Cmd+V (native paste + image handler own that)', () => {
    const event = { type: 'keydown', key: 'v', metaKey: true, ctrlKey: false, altKey: false };
    expect(clipboardKeyAction(event, false)).toBe('pass');
  });

  it('ignores keyup and non-mod keys', () => {
    expect(
      clipboardKeyAction(
        { type: 'keyup', key: 'c', metaKey: true, ctrlKey: false, altKey: false },
        true
      )
    ).toBe('pass');
    expect(
      clipboardKeyAction(
        { type: 'keydown', key: 'x', metaKey: true, ctrlKey: false, altKey: false },
        true
      )
    ).toBe('pass');
  });
});

describe('handleTerminalClipboardKey', () => {
  const term = {
    hasSelection: vi.fn(),
    getSelection: vi.fn(),
    selectAll: vi.fn(),
  };

  beforeEach(() => {
    term.hasSelection.mockReset();
    term.getSelection.mockReset();
    term.selectAll.mockReset();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue(''),
      },
    });
  });

  it('copies the selection and swallows Cmd+C', async () => {
    term.hasSelection.mockReturnValue(true);
    term.getSelection.mockReturnValue('picked');
    const event = new KeyboardEvent('keydown', { key: 'c', metaKey: true });
    expect(handleTerminalClipboardKey(event, term)).toBe(false);
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('picked'));
    expect(term.selectAll).not.toHaveBeenCalled();
  });

  it('selects all and swallows Cmd+A', () => {
    term.hasSelection.mockReturnValue(false);
    const event = new KeyboardEvent('keydown', { key: 'a', metaKey: true });
    expect(handleTerminalClipboardKey(event, term)).toBe(false);
    expect(term.selectAll).toHaveBeenCalledTimes(1);
  });

  it('passes through ordinary keys', () => {
    const event = new KeyboardEvent('keydown', { key: 'c', metaKey: true });
    term.hasSelection.mockReturnValue(false);
    expect(handleTerminalClipboardKey(event, term)).toBe(true);
  });
});

describe('copyText / readClipboardText', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue('from-board'),
      },
    });
  });

  it('writes non-empty text to the clipboard', async () => {
    await expect(copyText('hello')).resolves.toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
  });

  it('refuses to write an empty selection', async () => {
    await expect(copyText('')).resolves.toBe(false);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('reads clipboard text', async () => {
    await expect(readClipboardText()).resolves.toBe('from-board');
  });

  it('returns empty string when the clipboard API is missing', async () => {
    Object.assign(navigator, { clipboard: undefined });
    await expect(readClipboardText()).resolves.toBe('');
    await expect(copyText('x')).resolves.toBe(false);
  });
});

describe('buildTerminalMenu', () => {
  it('always offers paste and select-all', () => {
    const items = buildTerminalMenu('', false);
    expect(items.map((i) => i.kind)).toEqual(['paste', 'select-all']);
  });

  it('adds copy when there is a selection', () => {
    const items = buildTerminalMenu('foo', false);
    expect(items.map((i) => i.kind)).toEqual(['copy', 'paste', 'select-all']);
  });

  it('adds spawn under a separator when a selection can launch an agent', () => {
    const items = buildTerminalMenu('error on line 42', true);
    expect(items.map((i) => i.kind)).toEqual(['copy', 'paste', 'select-all', 'separator', 'spawn']);
    expect(items.find((i) => i.kind === 'spawn')?.label).toBe('Spawn Agent with Selection');
  });

  it('does not offer spawn without a selection, even if a callback exists', () => {
    expect(buildTerminalMenu('', true).some((i) => i.kind === 'spawn')).toBe(false);
  });
});

describe('terminalMenuActions', () => {
  it('wires each item to the matching handler and skips separators', () => {
    const handlers = {
      copy: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
      spawn: vi.fn(),
    };
    const options = terminalMenuActions(buildTerminalMenu('sel', true), handlers);
    expect(options.filter((o) => o.type === 'separator')).toHaveLength(1);
    const items = options.filter(
      (o): o is { type?: 'item'; label: string; action?: () => void } => o.type !== 'separator'
    );
    expect(items.map((o) => o.label)).toEqual([
      'Copy',
      'Paste',
      'Select All',
      'Spawn Agent with Selection',
    ]);

    items.find((o) => o.label === 'Copy')?.action?.();
    expect(handlers.copy).toHaveBeenCalledTimes(1);
  });
});
