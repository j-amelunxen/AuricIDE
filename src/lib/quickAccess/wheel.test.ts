import { describe, expect, it } from 'vitest';
import {
  DWELL_DOTS_MS,
  DWELL_LEAVE_GRACE_MS,
  DWELL_OPEN_MS,
  HOLD_OPEN_MS,
  WHEEL_SLOT_COUNT,
  assignSkillToSlot,
  availableSkillsForSlot,
  createWheelMachine,
  normalizeWheelSlots,
  reduceWheel,
  skillMark,
  slotIndexAt,
  wheelSlotPositions,
  type QuickAccessSkillRef,
} from './wheel';

const skill = (id: string, label = id): QuickAccessSkillRef => ({ id, label });

describe('normalizeWheelSlots', () => {
  it('pads to a fixed length of empty slots', () => {
    expect(normalizeWheelSlots(undefined, ['s1'])).toEqual(Array(WHEEL_SLOT_COUNT).fill(null));
  });

  it('keeps a skill on the slot it was assigned to', () => {
    const raw = [null, 's1', null];
    expect(normalizeWheelSlots(raw, ['s1'])[1]).toBe('s1');
  });

  it('drops a slot whose skill is no longer configured', () => {
    const slots = normalizeWheelSlots(['gone', 's1'], ['s1']);
    expect(slots[0]).toBeNull();
    expect(slots[1]).toBe('s1');
  });

  it('keeps the first slot when the same skill is assigned twice', () => {
    const slots = normalizeWheelSlots(['s1', 's1'], ['s1']);
    expect(slots[0]).toBe('s1');
    expect(slots[1]).toBeNull();
  });

  it('ignores anything past the fixed slot count', () => {
    const tooMany = Array.from({ length: 12 }, (_, i) => `s${i}`);
    expect(normalizeWheelSlots(tooMany, tooMany).length).toBe(WHEEL_SLOT_COUNT);
  });
});

describe('assignSkillToSlot', () => {
  const known = ['research', 'changelog', 'seo'];

  it('places a configured skill on the chosen slot', () => {
    const slots = assignSkillToSlot(emptySlots(), 2, 'research', known);
    expect(slots[2]).toBe('research');
  });

  it('refuses a skill that is not in the configured set', () => {
    const slots = assignSkillToSlot(emptySlots(), 0, 'unknown', known);
    expect(slots[0]).toBeNull();
  });

  it('moves a skill that already occupies another slot', () => {
    const start = assignSkillToSlot(emptySlots(), 0, 'research', known);
    const moved = assignSkillToSlot(start, 4, 'research', known);
    expect(moved[0]).toBeNull();
    expect(moved[4]).toBe('research');
  });

  it('leaves other slots alone', () => {
    const start = assignSkillToSlot(emptySlots(), 1, 'changelog', known);
    const next = assignSkillToSlot(start, 3, 'seo', known);
    expect(next[1]).toBe('changelog');
    expect(next[3]).toBe('seo');
  });
});

describe('availableSkillsForSlot', () => {
  const skills = [skill('research', 'Research'), skill('seo', 'SEO'), skill('ship', 'Ship')];

  it('offers every configured skill when the wheel is empty', () => {
    expect(availableSkillsForSlot(skills, emptySlots(), 0).map((s) => s.id)).toEqual([
      'research',
      'seo',
      'ship',
    ]);
  });

  it('hides skills already sitting on other slots', () => {
    const slots = assignSkillToSlot(emptySlots(), 2, 'seo', ['research', 'seo', 'ship']);
    expect(availableSkillsForSlot(skills, slots, 0).map((s) => s.id)).toEqual(['research', 'ship']);
  });

  it('still offers the skill that already occupies this slot', () => {
    const slots = assignSkillToSlot(emptySlots(), 0, 'seo', ['research', 'seo', 'ship']);
    expect(availableSkillsForSlot(skills, slots, 0).map((s) => s.id)).toContain('seo');
  });
});

describe('skillMark', () => {
  it('uses the first letter of the label', () => {
    expect(skillMark('Research')).toBe('R');
    expect(skillMark('  seo')).toBe('S');
  });

  it('falls back to a plus when the label has no letter', () => {
    expect(skillMark('')).toBe('+');
    expect(skillMark('***')).toBe('+');
  });
});

describe('wheelSlotPositions', () => {
  const positions = wheelSlotPositions();

  it('lays out a fixed number of slots', () => {
    expect(positions).toHaveLength(WHEEL_SLOT_COUNT);
  });

  it('sits in the upper half so the dock row is not covered', () => {
    expect(positions.every((p) => p.y <= 0)).toBe(true);
  });

  it('keeps slot 0 on the left and the last slot on the right', () => {
    expect(positions[0].x).toBeLessThan(positions[WHEEL_SLOT_COUNT - 1].x);
  });
});

describe('slotIndexAt', () => {
  const positions = wheelSlotPositions();

  it('returns the slot whose centre the pointer is on', () => {
    const slot = positions[2];
    expect(slotIndexAt(slot.x, slot.y)).toBe(2);
  });

  it('ignores the tile itself', () => {
    expect(slotIndexAt(0, 0)).toBeNull();
  });

  it('ignores a pointer far from every slot', () => {
    expect(slotIndexAt(400, 400)).toBeNull();
  });
});

describe('dwell machine', () => {
  it('stays idle before the dots threshold', () => {
    let { state } = reduceWheel(createWheelMachine(), { type: 'enter', now: 0 });
    ({ state } = reduceWheel(state, { type: 'tick', now: DWELL_DOTS_MS - 1 }));
    expect(state.phase).toBe('idle');
  });

  it('shows dots at 200ms and ignites at 300ms', () => {
    let { state } = reduceWheel(createWheelMachine(), { type: 'enter', now: 0 });
    ({ state } = reduceWheel(state, { type: 'tick', now: DWELL_DOTS_MS }));
    expect(state.phase).toBe('dots');
    ({ state } = reduceWheel(state, { type: 'tick', now: DWELL_OPEN_MS }));
    expect(state.phase).toBe('open');
    expect(state.mode).toBe('dwell');
  });

  it('does not ignite after a leave before the dots appear', () => {
    let { state } = reduceWheel(createWheelMachine(), { type: 'enter', now: 0 });
    ({ state } = reduceWheel(state, { type: 'leave', now: 80 }));
    ({ state } = reduceWheel(state, { type: 'tick', now: 80 + DWELL_LEAVE_GRACE_MS }));
    expect(state.phase).toBe('idle');
    expect(state.mode).toBe('none');
  });

  it('keeps the open wheel through a short leave, then closes after grace', () => {
    let { state } = reduceWheel(createWheelMachine(), { type: 'enter', now: 0 });
    ({ state } = reduceWheel(state, { type: 'tick', now: DWELL_OPEN_MS }));
    ({ state } = reduceWheel(state, { type: 'leave', now: 400 }));
    ({ state } = reduceWheel(state, { type: 'tick', now: 400 + DWELL_LEAVE_GRACE_MS - 1 }));
    expect(state.phase).toBe('open');
    ({ state } = reduceWheel(state, { type: 'tick', now: 400 + DWELL_LEAVE_GRACE_MS }));
    expect(state.phase).toBe('idle');
  });

  it('cancels the leave grace when the pointer comes back', () => {
    let { state } = reduceWheel(createWheelMachine(), { type: 'enter', now: 0 });
    ({ state } = reduceWheel(state, { type: 'tick', now: DWELL_OPEN_MS }));
    ({ state } = reduceWheel(state, { type: 'leave', now: 400 }));
    ({ state } = reduceWheel(state, { type: 'enter', now: 450 }));
    ({ state } = reduceWheel(state, { type: 'tick', now: 800 }));
    expect(state.phase).toBe('open');
  });
});

describe('hold machine', () => {
  it('treats a short press as a tile click', () => {
    let { state, action } = reduceWheel(createWheelMachine(), { type: 'down', now: 0 });
    ({ state, action } = reduceWheel(state, { type: 'up', now: HOLD_OPEN_MS - 10 }));
    expect(action).toEqual({ type: 'click-tile' });
    expect(state.phase).toBe('idle');
    expect(state.consumedClick).toBe(false);
  });

  it('opens the wheel on hold without waiting for the dwell', () => {
    let { state } = reduceWheel(createWheelMachine(), { type: 'down', now: 0 });
    ({ state } = reduceWheel(state, { type: 'tick', now: HOLD_OPEN_MS }));
    expect(state.phase).toBe('open');
    expect(state.mode).toBe('hold');
  });

  it('fires the armed slot on release and swallows the click', () => {
    let { state, action } = reduceWheel(createWheelMachine(), { type: 'down', now: 0 });
    ({ state } = reduceWheel(state, { type: 'tick', now: HOLD_OPEN_MS }));
    ({ state } = reduceWheel(state, { type: 'aim', slot: 3 }));
    ({ state, action } = reduceWheel(state, { type: 'up', now: 400 }));
    expect(action).toEqual({ type: 'hold-release', slot: 3 });
    expect(state.consumedClick).toBe(true);
    expect(state.phase).toBe('idle');
  });

  it('does not launch when release happens off every slot', () => {
    let { state, action } = reduceWheel(createWheelMachine(), { type: 'down', now: 0 });
    ({ state } = reduceWheel(state, { type: 'tick', now: HOLD_OPEN_MS }));
    ({ state, action } = reduceWheel(state, { type: 'up', now: 400 }));
    expect(action).toEqual({ type: 'hold-release', slot: null });
    expect(state.consumedClick).toBe(true);
  });

  it('takes over an already-open dwell wheel without waiting', () => {
    let { state } = reduceWheel(createWheelMachine(), { type: 'enter', now: 0 });
    ({ state } = reduceWheel(state, { type: 'tick', now: DWELL_OPEN_MS }));
    ({ state } = reduceWheel(state, { type: 'down', now: 500 }));
    expect(state.mode).toBe('hold');
    expect(state.phase).toBe('open');
  });
});

function emptySlots(): (string | null)[] {
  return Array(WHEEL_SLOT_COUNT).fill(null);
}
