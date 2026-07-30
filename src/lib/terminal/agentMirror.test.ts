import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import {
  agentMirrorResized,
  disposeAllAgentMirrors,
  onAgentPtyResize,
  resizeAgentMirror,
} from './agentMirror';

describe('agent PTY resize propagation', () => {
  beforeEach(() => {
    disposeAllAgentMirrors();
    useStore.setState({ agentLogs: {}, agentLogMeta: {} });
  });

  it('notifies listeners when the PTY size changes', () => {
    const listener = vi.fn();
    onAgentPtyResize('a1', listener);

    resizeAgentMirror('a1', 40, 160);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ rows: 40, cols: 160 });
  });

  it('does not notify when the size is unchanged', () => {
    const listener = vi.fn();
    resizeAgentMirror('a1', 40, 160);
    onAgentPtyResize('a1', listener);

    resizeAgentMirror('a1', 40, 160);

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify listeners of other agents', () => {
    const listener = vi.fn();
    onAgentPtyResize('a1', listener);

    resizeAgentMirror('a2', 40, 160);

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = onAgentPtyResize('a1', listener);
    unsubscribe();

    resizeAgentMirror('a1', 40, 160);

    expect(listener).not.toHaveBeenCalled();
  });

  it('agentMirrorResized is false for a mirror that never changed size', () => {
    useStore.getState().appendAgentLog('a1', 'hello');
    expect(agentMirrorResized('a1')).toBe(false);
  });

  it('agentMirrorResized is true once the mirror was resized after output existed', () => {
    useStore.getState().appendAgentLog('a1', 'hello');
    resizeAgentMirror('a1', 40, 160);
    expect(agentMirrorResized('a1')).toBe(true);
  });

  it('agentMirrorResized stays false when the size was set before any output', () => {
    resizeAgentMirror('a1', 40, 160);
    useStore.getState().appendAgentLog('a1', 'hello');
    // All chunks were produced at a single geometry — raw replay is faithful.
    expect(agentMirrorResized('a1')).toBe(false);
  });
});
