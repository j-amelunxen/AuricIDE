import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../agents/agentWindow.fixtures.json';

const invokeMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const emitToMock = vi.fn(async (..._args: unknown[]) => undefined);
const listenMock = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({ emitTo: emitToMock, listen: listenMock }));

const {
  focusAgentWindow,
  focusMainWindow,
  onAgentWindowState,
  onWindowMessage,
  openAgentWindow,
  sendToWindow,
} = await import('./agentWindow');

type Handler = (event: { payload: unknown }) => void;

beforeEach(() => {
  vi.clearAllMocks();
  listenMock.mockResolvedValue(vi.fn());
});

describe('agent window commands', () => {
  it('invokes the commands the contract names', async () => {
    await openAgentWindow();
    await focusAgentWindow();
    await focusMainWindow();

    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual([
      fixtures.commands.open,
      fixtures.commands.focus,
      fixtures.commands.focusMain,
    ]);
  });
});

describe('sendToWindow', () => {
  it('emits to the one window named, not to everyone', async () => {
    await sendToWindow('agents', 'agent-window:show', { agentId: 'agent-1' });
    expect(emitToMock).toHaveBeenCalledWith('agents', 'agent-window:show', { agentId: 'agent-1' });
  });

  it('sends a message that carries nothing', async () => {
    await sendToWindow('main', 'agent-window:hello');
    expect(emitToMock).toHaveBeenCalledWith('main', 'agent-window:hello', undefined);
  });
});

describe('listening', () => {
  it('hands a window message’s payload to the callback and reports when it listens', async () => {
    let handler: Handler | undefined;
    listenMock.mockImplementation(async (_name: string, fn: Handler) => {
      handler = fn;
      return vi.fn();
    });
    const callback = vi.fn();
    const onListening = vi.fn();

    onWindowMessage('agent-window:hello', callback, onListening);

    await vi.waitFor(() => expect(onListening).toHaveBeenCalledTimes(1));
    expect(listenMock).toHaveBeenCalledWith('agent-window:hello', expect.any(Function));
    handler?.({ payload: { any: 'thing' } });
    expect(callback).toHaveBeenCalledWith({ any: 'thing' });
  });

  it('stops listening on unsubscribe', async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const onListening = vi.fn();
    const stop = onWindowMessage('agent-window:hello', vi.fn(), onListening);
    await vi.waitFor(() => expect(onListening).toHaveBeenCalled());

    stop();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('listens for the window state under the name Rust emits it', async () => {
    onAgentWindowState(vi.fn());
    await vi.waitFor(() =>
      expect(listenMock).toHaveBeenCalledWith(fixtures.rustEvents.windowState, expect.any(Function))
    );
  });
});
