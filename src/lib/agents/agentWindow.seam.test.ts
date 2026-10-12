import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Terminal } from '@xterm/headless';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { OutputBatch } from './outputBatcher';
import fixtures from './agentWindow.fixtures.json';

/**
 * The seam between the two windows with nothing of ours faked: the real
 * store, output batcher, headless mirror, gate and `attachAgentStream` on
 * both sides, and the real `@tauri-apps/api` on top of a fake IPC. That fake
 * is the only stand-in: an event bus that carries messages between the
 * windows and lets the test decide when one arrives — the one thing the real
 * transport does not promise.
 *
 * A webview has its own heap; here both sides would share one module
 * registry. So the main window's modules are loaded first, the registry is
 * reset, and the agent window gets a second copy of everything: its own
 * store, its own mirrors. `window`, and with it the bus, is what they share —
 * as two webviews share the Rust process.
 */
interface TauriEvent {
  event: string;
  id: number;
  payload: unknown;
}

function installFakeTauriIpc() {
  const callbacks = new Map<number, (event: TauriEvent) => void>();
  const listeners = new Map<string, Set<number>>();
  const held = new Map<string, unknown[]>();
  let nextCallbackId = 1;

  const deliver = (event: string, payload: unknown) => {
    for (const id of Array.from(listeners.get(event) ?? [])) {
      callbacks.get(id)?.({ event, id, payload });
    }
  };
  /** As over IPC: the payload arrives as a copy, and "nothing" arrives as null. */
  const emit = (event: string, payload?: unknown) => {
    const copy =
      payload === undefined || payload === null
        ? null
        : (JSON.parse(JSON.stringify(payload)) as unknown);
    const queue = held.get(event);
    if (queue) queue.push(copy);
    else deliver(event, copy);
  };

  const globals = window as unknown as Record<string, unknown>;
  globals.__TAURI_INTERNALS__ = {
    transformCallback: (callback: (event: TauriEvent) => void) => {
      const id = nextCallbackId++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id: number) => void callbacks.delete(id),
    invoke: async (
      cmd: string,
      args: { event?: string; handler?: number; eventId?: number; payload?: unknown } = {}
    ) => {
      const event = args.event ?? '';
      if (cmd === 'plugin:event|listen' && args.handler !== undefined) {
        const set = listeners.get(event) ?? new Set<number>();
        listeners.set(event, set);
        set.add(args.handler);
        return args.handler;
      }
      if (cmd === 'plugin:event|unlisten' && args.eventId !== undefined) {
        listeners.get(event)?.delete(args.eventId);
      } else if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') {
        emit(event, args.payload);
      }
      // Every other command — focus, persistence — succeeds and returns nothing.
      return undefined;
    },
  };
  globals.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

  return {
    emit,
    /** Keep messages of this name in transit until `release`. */
    hold: (event: string) => void held.set(event, []),
    release: (event: string) => {
      const queue = held.get(event) ?? [];
      held.delete(event);
      for (const payload of queue) deliver(event, payload);
    },
    inTransit: (event: string) => held.get(event)?.length ?? 0,
    listeners: (event: string) => listeners.get(event)?.size ?? 0,
    uninstall: () => {
      delete globals.__TAURI_INTERNALS__;
      delete globals.__TAURI_EVENT_PLUGIN_INTERNALS__;
    },
  };
}

let bus: ReturnType<typeof installFakeTauriIpc>;

const { hostEvents, clientEvents, rustEvents } = fixtures;

const AGENT: AgentInfo = {
  id: 'agent-1',
  name: 'Fix the parser',
  status: 'running',
  model: 'model-a',
  provider: 'provider-a',
  startedAt: 1,
};

const LINES = ['line-1', 'line-2', 'line-3', 'line-4', 'line-5'];

/** Rust emitting one batch: to every window, stamped with the bytes so far. */
function rustPrints(lineNumber: number): void {
  const line = `${LINES[lineNumber - 1]}\r\n`;
  bus.emit(rustEvents.agentOutput, {
    agentId: AGENT.id,
    stream: 'stdout',
    line,
    timestamp: lineNumber,
    repoPath: null,
    endOffset: lineNumber * line.length,
  });
}

async function loadMainWindow() {
  const { useStore } = await import('@/lib/store');
  const { flushAgentOutput, useBatchedAgentEvents } = await import('@/lib/hooks/useAgentEvents');
  const { installAgentWindowHost } = await import('./agentWindowHost');
  return { useStore, flushAgentOutput, useBatchedAgentEvents, installAgentWindowHost };
}

async function loadAgentWindow() {
  vi.resetModules();
  const { useStore } = await import('@/lib/store');
  const { installAgentWindowClient } = await import('./agentWindowClient');
  const { attachAgentStream } = await import('@/lib/terminal/agentStream');
  return { useStore, installAgentWindowClient, attachAgentStream };
}

/** What the terminal shows, row by row, once it has parsed everything written. */
async function shownOn(term: Terminal): Promise<string[]> {
  await new Promise<void>((resolve) => term.write('', resolve));
  const rows: string[] = [];
  for (let i = 0; i < term.buffer.active.length; i++) {
    const text = term.buffer.active.getLine(i)?.translateToString(true) ?? '';
    if (text) rows.push(text);
  }
  return rows;
}

const cleanups: Array<() => void> = [];

beforeEach(() => {
  bus = installFakeTauriIpc();
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  bus.uninstall();
});

describe('agent window seam, end to end', () => {
  it('shows every line exactly once, in order, across snapshot and live stream', async () => {
    // ── Main window: an agent mid-run ─────────────────────────────────────
    const main = await loadMainWindow();
    main.useStore.setState({ agents: [AGENT] });
    const noActions = { onKill() {}, onDismiss() {}, onSaveScratch() {}, onDock() {} };
    cleanups.push(main.installAgentWindowHost(noActions));
    const toStore = (batch: OutputBatch) => main.useStore.getState().appendAgentLogBatch(batch);
    const onStatus = () => {};
    const hook = renderHook(() => main.useBatchedAgentEvents(toStore, onStatus));
    cleanups.push(hook.unmount);
    await vi.waitFor(() => {
      expect(bus.listeners(rustEvents.agentOutput)).toBe(1);
      expect(bus.listeners(clientEvents.snapshotRequest)).toBe(1);
    });

    rustPrints(1);
    rustPrints(2);
    main.flushAgentOutput();

    // ── Agent window opens; from here the test paces the three messages ───
    bus.hold(clientEvents.hello);
    bus.hold(clientEvents.snapshotRequest);
    bus.hold(hostEvents.snapshot);
    const agents = await loadAgentWindow();
    expect(agents.useStore).not.toBe(main.useStore);
    cleanups.push(agents.installAgentWindowClient());
    await vi.waitFor(() => expect(bus.inTransit(clientEvents.hello)).toBe(1));

    bus.release(clientEvents.hello);
    await vi.waitFor(() => expect(bus.inTransit(clientEvents.snapshotRequest)).toBe(1));

    // Printed while the request is on its way. The main window parks it for
    // its next frame; the agent window buffers it. It is the batch both
    // halves of the rule are about: the snapshot must hold it (the host's
    // flush), and the agent window must then not write it again (the gate).
    rustPrints(3);
    bus.release(clientEvents.snapshotRequest);

    // Printed after the screen was taken, before it arrives.
    rustPrints(4);
    await vi.waitFor(() => expect(bus.inTransit(hostEvents.snapshot)).toBe(1));
    bus.release(hostEvents.snapshot);

    // Printed once the agent window is synced.
    rustPrints(5);

    // ── A terminal in the agent window ───────────────────────────────────
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    cleanups.push(() => term.dispose());
    const stream = agents.attachAgentStream(term, AGENT.id);
    cleanups.push(stream.detach);
    await stream.restored;

    await vi.waitFor(async () => expect(await shownOn(term)).toEqual(LINES));

    // One writer per field, seen from outside: the agent window knows the
    // agent from the roster and worked nothing out from the lines it wrote.
    const windowState = agents.useStore.getState();
    expect(windowState.agents.map((a) => a.id)).toEqual([AGENT.id]);
    expect(windowState.agentEvents).toEqual({});
    expect(windowState.agentStreamLines).toEqual({});
  });
});
