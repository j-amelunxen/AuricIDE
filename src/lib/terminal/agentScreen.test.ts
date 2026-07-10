/**
 * Screen-level regression tests for the agent terminal glitches: instead of
 * asserting on chunk bookkeeping, these tests render the stream into real
 * (headless) xterm instances and compare what is actually ON SCREEN.
 *
 * Core invariant: a terminal attached late — after the store trimmed old
 * chunks away — must show the same screen as a terminal that was attached
 * from the very first chunk. Raw-history replay violates this because the
 * retained tail starts mid-frame: cursor-relative TUI redraws then paint
 * against a screen state that no longer exists (the "glitchy agent terminal"
 * bug: merged words, duplicated lines, stale fragments).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/headless';
import { useStore } from '../store';
import { MAX_AGENT_LOG_BYTES } from '../store/agentSlice';
import { attachAgentStream } from './agentStream';
import { disposeAllAgentMirrors } from './agentMirror';

const COLS = 80;
const ROWS = 24;

function makeTerm(): Terminal {
  return new Terminal({ cols: COLS, rows: ROWS, scrollback: 1000, allowProposedApi: true });
}

/** Resolve once everything queued into the terminal so far has been parsed. */
function flush(term: Terminal): Promise<void> {
  return new Promise((resolve) => term.write('', () => resolve()));
}

/** The visible screen (viewport) as trimmed text lines. */
function screenText(term: Terminal): string[] {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < term.rows; y++) {
    lines.push(buf.getLine(buf.viewportY + y)?.translateToString(true) ?? '');
  }
  return lines;
}

/**
 * Simulate a Claude-Code-style diff-rendering TUI: the static UI (transcript,
 * option list, help line) is painted ONCE, then only a single status row is
 * redrawn in place via absolute positioning. Replaying a trimmed tail never
 * re-paints the static rows — exactly the bug seen in the real agent
 * terminal (missing/stale/overlapping content).
 */
function tuiStaticScreen(): string {
  const rows: string[] = ['\x1b[2J\x1b[H'];
  for (let i = 1; i <= 10; i++) {
    rows.push(`transcript line ${i} — bisheriger Agent-Output\r\n`);
  }
  rows.push('❯ 1. vitest + RTL aufsetzen\r\n');
  rows.push('  2. ohne Unit-Tests bauen\r\n');
  rows.push('  3. nur Cypress-E2E\r\n');
  rows.push('Enter to select · ↑/↓ to navigate · Esc to cancel\r\n');
  return rows.join('');
}

function tuiStatusUpdate(i: number): string {
  const spinner = '◐◓◑◒'[i % 4];
  // Row 20, painted in place; padded so updates are byte-heavy like real frames.
  return `\x1b[20;1H\x1b[2Kstatus: working ${spinner} step ${i} ${'·'.repeat(50)}`;
}

/** Split a string into chunks of the given size (mid-sequence on purpose). */
function chunked(data: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < data.length; i += size) {
    out.push(data.slice(i, i + size));
  }
  return out;
}

async function appendAndSettle(agentId: string, chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    useStore.getState().appendAgentLog(agentId, chunk);
  }
  // Let any pending snapshot attach settle.
  await new Promise((r) => setTimeout(r, 0));
}

describe('agent terminal screen consistency', () => {
  beforeEach(() => {
    disposeAllAgentMirrors();
    useStore.setState({ agentLogs: {}, agentLogMeta: {} });
  });

  it('late attach after byte-cap trimming shows the same screen as an always-attached terminal', async () => {
    const agentId = 'glitchy';
    const liveTerm = makeTerm();
    const detachLive = attachAgentStream(liveTerm, agentId);

    // Static UI painted once, then enough in-place status updates to blow
    // past MAX_AGENT_LOG_BYTES so the store trims the static UI away. Chunk
    // size deliberately misaligned with frame length so the retained tail
    // starts mid-frame (like arbitrary PTY reads).
    const parts: string[] = [tuiStaticScreen()];
    let bytes = parts[0].length;
    for (let i = 0; bytes < MAX_AGENT_LOG_BYTES + 200_000; i++) {
      const update = tuiStatusUpdate(i);
      parts.push(update);
      bytes += update.length;
    }
    await appendAndSettle(agentId, chunked(parts.join(''), 4096 - 7));

    // Sanity: trimming must actually have happened for this test to bite.
    const meta = useStore.getState().agentLogMeta[agentId];
    const logs = useStore.getState().agentLogs[agentId];
    expect(meta.seq).toBeGreaterThan(logs.length);

    const lateTerm = makeTerm();
    const detachLate = attachAgentStream(lateTerm, agentId);
    // Chunks that stream in while the snapshot settles must be neither lost
    // nor duplicated on the late terminal.
    useStore.getState().appendAgentLog(agentId, tuiStatusUpdate(999_999));
    useStore.getState().appendAgentLog(agentId, '\x1b[22;1H\x1b[2Kfertig ✔\r\n');

    await new Promise((r) => setTimeout(r, 0));
    await flush(liveTerm);
    await flush(lateTerm);

    expect(screenText(lateTerm)).toEqual(screenText(liveTerm));
    expect(screenText(lateTerm).join('\n')).toContain('fertig ✔');
    expect(screenText(lateTerm).join('\n')).toContain('vitest + RTL aufsetzen');

    detachLive();
    detachLate();
  });

  it('chunks split mid-escape-sequence and mid-word render identically to one write', async () => {
    const agentId = 'split';
    const data =
      tuiStaticScreen() + Array.from({ length: 40 }, (_, i) => tuiStatusUpdate(i)).join('');

    const reference = makeTerm();
    reference.write(data);
    await flush(reference);

    const viaStore = makeTerm();
    const detach = attachAgentStream(viaStore, agentId);
    await appendAndSettle(agentId, chunked(data, 3));
    await flush(viaStore);

    expect(screenText(viaStore)).toEqual(screenText(reference));
    detach();
  });

  it('chunks appended while a late attach is settling are neither lost nor duplicated', async () => {
    const agentId = 'race';
    const liveTerm = makeTerm();
    const detachLive = attachAgentStream(liveTerm, agentId);

    await appendAndSettle(agentId, chunked(tuiStaticScreen() + tuiStatusUpdate(1), 100));

    const lateTerm = makeTerm();
    const detachLate = attachAgentStream(lateTerm, agentId);
    // Append MORE chunks synchronously, before the snapshot settles.
    useStore.getState().appendAgentLog(agentId, 'tail after attach\r\n');
    useStore.getState().appendAgentLog(agentId, 'and one more\r\n');

    await new Promise((r) => setTimeout(r, 0));
    await flush(liveTerm);
    await flush(lateTerm);

    expect(screenText(lateTerm)).toEqual(screenText(liveTerm));

    detachLive();
    detachLate();
  });
});
