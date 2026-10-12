import { describe, expect, it, vi } from 'vitest';
import { createAgentWindowGate, utf8ByteLength } from './agentWindowGate';

describe('utf8ByteLength', () => {
  it('counts bytes, not characters', () => {
    expect(utf8ByteLength('hello\r\n')).toBe(7);
    expect(utf8ByteLength('✓ ok')).toBe(6);
  });
});

/** A gate that has been told, as by a roster, to expect these agents. */
function createGateExpecting(...agentIds: string[]) {
  const gate = createAgentWindowGate();
  for (const id of agentIds) gate.expect(id);
  return gate;
}

describe('agent window gate', () => {
  it('holds batches back until the agent has a screen', () => {
    const gate = createGateExpecting('a1', 'a2');
    expect(gate.push('a1', 'late', 104)).toEqual([]);
    expect(gate.isSynced('a1')).toBe(false);
  });

  it('syncs a never-seen agent whose first batch starts at offset 0', () => {
    const gate = createGateExpecting('a1', 'a2');
    expect(gate.push('a1', 'hello\r\n', 7)).toEqual(['hello\r\n']);
    expect(gate.isSynced('a1')).toBe(true);
    expect(gate.push('a1', 'more', 11)).toEqual(['more']);
  });

  it('measures the start of a batch in bytes', () => {
    const gate = createGateExpecting('a1', 'a2');
    // Four characters, six bytes: this batch starts at 0 although 6 - 4 is 2.
    expect(gate.push('a1', '✓ ok', 6)).toEqual(['✓ ok']);
  });

  it('does not take offset 0 as a start for an agent it is already buffering', () => {
    const gate = createGateExpecting('a1', 'a2');
    gate.push('a1', 'tail', 104);
    expect(gate.push('a1', 'x', 1)).toEqual([]);
    expect(gate.isSynced('a1')).toBe(false);
  });

  it('applies only what the snapshot does not hold: snapshot in the middle', () => {
    const gate = createGateExpecting('a1', 'a2');
    gate.push('a1', 'one', 103);
    gate.push('a1', 'two', 106);
    gate.push('a1', 'three', 111);
    expect(gate.seed('a1', 106)).toEqual(['three']);
    expect(gate.isSynced('a1')).toBe(true);
  });

  it('drops everything buffered when the snapshot is newer than all of it', () => {
    const gate = createGateExpecting('a1', 'a2');
    gate.push('a1', 'one', 103);
    gate.push('a1', 'two', 106);
    expect(gate.seed('a1', 106)).toEqual([]);
    expect(gate.push('a1', 'three', 111)).toEqual(['three']);
  });

  it('keeps everything buffered when the snapshot is older than all of it', () => {
    const gate = createGateExpecting('a1', 'a2');
    gate.push('a1', 'one', 103);
    gate.push('a1', 'two', 106);
    expect(gate.seed('a1', 100)).toEqual(['one', 'two']);
  });

  it('syncs an agent that never sent a batch, such as a finished one', () => {
    const gate = createGateExpecting('a1', 'a2');
    expect(gate.seed('a1', 4096)).toEqual([]);
    expect(gate.isSynced('a1')).toBe(true);
    expect(gate.push('a1', 'after', 4101)).toEqual(['after']);
  });

  it('ignores a second snapshot', () => {
    const gate = createGateExpecting('a1', 'a2');
    gate.push('a1', 'one', 103);
    expect(gate.seed('a1', 100)).toEqual(['one']);
    expect(gate.seed('a1', 0)).toEqual([]);
  });

  it('ignores a snapshot for an agent that synced from offset 0', () => {
    const gate = createGateExpecting('a1', 'a2');
    gate.push('a1', 'hello', 5);
    expect(gate.seed('a1', 0)).toEqual([]);
  });

  it('keeps agents apart', () => {
    const gate = createGateExpecting('a1', 'a2');
    gate.push('a1', 'one', 103);
    gate.push('a2', 'other', 205);
    expect(gate.seed('a2', 200)).toEqual(['other']);
    expect(gate.isSynced('a1')).toBe(false);
  });

  it('forgets an agent entirely', () => {
    const gate = createGateExpecting('a1', 'a2');
    gate.push('a1', 'one', 103);
    gate.forget('a1');
    expect(gate.seed('a1', 0)).toEqual([]);
    gate.forget('a1');
    expect(gate.isSynced('a1')).toBe(false);
  });
});

describe('agent window gate — only expected agents are buffered for', () => {
  it('drops a mid-run batch of an agent no roster has named', () => {
    const gate = createAgentWindowGate();
    expect(gate.push('stranger', 'mid-run', 104)).toEqual([]);

    // Named later, a snapshot covers what went by. Seeded here from before
    // that batch, to show it was dropped and not merely filtered out.
    gate.expect('stranger');
    gate.push('stranger', 'after', 109);
    expect(gate.seed('stranger', 100)).toEqual(['after']);
  });

  it('still syncs an unnamed agent on the spot when its run starts here', () => {
    const gate = createAgentWindowGate();
    expect(gate.push('just-started', 'hello', 5)).toEqual(['hello']);
    expect(gate.push('just-started', ' again', 11)).toEqual([' again']);
  });

  it('buffers nothing for an agent after it was forgotten', () => {
    const gate = createGateExpecting('a1');
    gate.push('a1', 'one', 103);
    gate.forget('a1');
    gate.push('a1', 'two', 106);

    gate.expect('a1');
    expect(gate.seed('a1', 0)).toEqual([]);
  });

  it('stops passing lines through for a synced agent once it is forgotten', () => {
    const gate = createGateExpecting('a1');
    gate.seed('a1', 100);
    gate.forget('a1');
    expect(gate.push('a1', 'ghost', 105)).toEqual([]);
  });
});

describe('agent window gate — a bounded buffer', () => {
  function overflowing() {
    const onOverflow = vi.fn();
    const gate = createAgentWindowGate({ maxBufferedBytes: 10, onOverflow });
    gate.expect('a1');
    return { gate, onOverflow };
  }

  it('drops the buffer past the cap and asks for a fresh snapshot', () => {
    const { gate, onOverflow } = overflowing();
    expect(gate.push('a1', '123456', 106)).toEqual([]);
    expect(onOverflow).not.toHaveBeenCalled();

    expect(gate.push('a1', '789012', 112)).toEqual([]);

    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(onOverflow).toHaveBeenCalledWith('a1');
    expect(gate.isSynced('a1')).toBe(false);
  });

  it('refuses a snapshot from before the drop: it would leave a hole', () => {
    const { gate } = overflowing();
    gate.push('a1', '123456', 106);
    gate.push('a1', '789012', 112);

    expect(gate.seed('a1', 106)).toBeNull();
    expect(gate.isSynced('a1')).toBe(false);
  });

  it('takes a snapshot that covers the drop, with what was buffered since', () => {
    const { gate } = overflowing();
    gate.push('a1', '123456', 106);
    gate.push('a1', '789012', 112);
    gate.push('a1', 'next', 116);
    gate.push('a1', 'last', 120);

    expect(gate.seed('a1', 116)).toEqual(['last']);
    expect(gate.isSynced('a1')).toBe(true);
  });
});
