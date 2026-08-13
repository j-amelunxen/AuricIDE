/** Fixed slots around a Quick Access tile. Index is identity — muscle memory. */
export const WHEEL_SLOT_COUNT = 6;

export const DWELL_DOTS_MS = 200;
export const DWELL_OPEN_MS = 300;
export const DWELL_LEAVE_GRACE_MS = 150;
/** Hold is intent, so the wheel skips the dwell. Still long enough that a tap is a tap. */
export const HOLD_OPEN_MS = 140;

export const WHEEL_RADIUS = 56;
export const SLOT_HIT_RADIUS = 20;
const TILE_DEAD_ZONE = 22;

export type WheelPhase = 'idle' | 'dots' | 'open';
export type WheelMode = 'none' | 'dwell' | 'hold';

export interface WheelMachine {
  phase: WheelPhase;
  mode: WheelMode;
  startedAt: number | null;
  leaveAt: number | null;
  armedSlot: number | null;
  consumedClick: boolean;
}

export type WheelEvent =
  | { type: 'enter'; now: number }
  | { type: 'leave'; now: number }
  | { type: 'down'; now: number }
  | { type: 'up'; now: number }
  | { type: 'tick'; now: number }
  | { type: 'aim'; slot: number | null }
  | { type: 'cancel' };

export type WheelAction =
  { type: 'none' } | { type: 'click-tile' } | { type: 'hold-release'; slot: number | null };

export interface WheelSlotPosition {
  x: number;
  y: number;
}

export interface QuickAccessSkillRef {
  id: string;
  label: string;
}

export function createWheelMachine(): WheelMachine {
  return {
    phase: 'idle',
    mode: 'none',
    startedAt: null,
    leaveAt: null,
    armedSlot: null,
    consumedClick: false,
  };
}

export function reduceWheel(
  state: WheelMachine,
  event: WheelEvent
): { state: WheelMachine; action: WheelAction } {
  switch (event.type) {
    case 'enter':
      return { state: onEnter(state, event.now), action: { type: 'none' } };
    case 'leave':
      return { state: onLeave(state, event.now), action: { type: 'none' } };
    case 'down':
      return { state: onDown(state, event.now), action: { type: 'none' } };
    case 'up':
      return onUp(state);
    case 'tick':
      return { state: onTick(state, event.now), action: { type: 'none' } };
    case 'aim':
      return { state: { ...state, armedSlot: event.slot }, action: { type: 'none' } };
    case 'cancel':
      return { state: createWheelMachine(), action: { type: 'none' } };
  }
}

function onEnter(state: WheelMachine, now: number): WheelMachine {
  if (state.leaveAt !== null) {
    return { ...state, leaveAt: null };
  }
  if (state.mode === 'hold') return state;
  if (state.mode === 'dwell' && state.startedAt !== null) return state;
  return {
    ...state,
    mode: 'dwell',
    startedAt: now,
    leaveAt: null,
    consumedClick: false,
  };
}

function onLeave(state: WheelMachine, now: number): WheelMachine {
  if (state.mode === 'hold') return state;
  if (state.mode === 'none') return state;
  return { ...state, leaveAt: now };
}

function onDown(state: WheelMachine, now: number): WheelMachine {
  const alreadyOpen = state.phase === 'open';
  return {
    ...state,
    mode: 'hold',
    startedAt: now,
    leaveAt: null,
    phase: alreadyOpen ? 'open' : 'idle',
    armedSlot: alreadyOpen ? state.armedSlot : null,
    consumedClick: false,
  };
}

function onUp(state: WheelMachine): { state: WheelMachine; action: WheelAction } {
  if (state.mode !== 'hold') {
    return { state, action: { type: 'none' } };
  }
  if (state.phase === 'open') {
    return {
      state: { ...createWheelMachine(), consumedClick: true },
      action: { type: 'hold-release', slot: state.armedSlot },
    };
  }
  return { state: createWheelMachine(), action: { type: 'click-tile' } };
}

function onTick(state: WheelMachine, now: number): WheelMachine {
  if (state.leaveAt !== null && state.mode !== 'hold') {
    if (now - state.leaveAt >= DWELL_LEAVE_GRACE_MS) {
      return createWheelMachine();
    }
  }
  if (state.startedAt === null) return state;
  if (state.mode === 'dwell') {
    const elapsed = now - state.startedAt;
    if (elapsed >= DWELL_OPEN_MS) return { ...state, phase: 'open' };
    if (elapsed >= DWELL_DOTS_MS) return { ...state, phase: 'dots' };
    return state;
  }
  if (state.mode === 'hold' && now - state.startedAt >= HOLD_OPEN_MS) {
    return { ...state, phase: 'open' };
  }
  return state;
}

export function normalizeWheelSlots(
  raw: Array<string | null> | undefined,
  knownSkillIds: Iterable<string>
): (string | null)[] {
  const known = new Set(knownSkillIds);
  const seen = new Set<string>();
  const slots: (string | null)[] = Array(WHEEL_SLOT_COUNT).fill(null);
  for (let i = 0; i < Math.min(raw?.length ?? 0, WHEEL_SLOT_COUNT); i += 1) {
    const id = raw?.[i];
    if (typeof id !== 'string' || id.length === 0) continue;
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    slots[i] = id;
  }
  return slots;
}

export function assignSkillToSlot(
  slots: (string | null)[],
  index: number,
  skillId: string,
  knownSkillIds: Iterable<string>
): (string | null)[] {
  const known = new Set(knownSkillIds);
  if (!known.has(skillId)) return normalizeWheelSlots(slots, known);
  if (index < 0 || index >= WHEEL_SLOT_COUNT) return normalizeWheelSlots(slots, known);
  const next = normalizeWheelSlots(slots, known).map((id) => (id === skillId ? null : id));
  next[index] = skillId;
  return next;
}

export function availableSkillsForSlot<T extends QuickAccessSkillRef>(
  skills: T[],
  slots: (string | null)[],
  slotIndex: number
): T[] {
  const taken = new Set(
    slots.filter((id, index): id is string => id !== null && index !== slotIndex)
  );
  return skills.filter((skill) => !taken.has(skill.id));
}

export function skillMark(label: string): string {
  const letter = label.trim().match(/\p{L}/u);
  return letter ? letter[0].toLocaleUpperCase() : '+';
}

/**
 * Upper semicircle, slot 0 on the left. Screen y grows down, so "up" is negative.
 */
export function wheelSlotPositions(
  count = WHEEL_SLOT_COUNT,
  radius = WHEEL_RADIUS
): WheelSlotPosition[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, y: -radius }];
  return Array.from({ length: count }, (_, index) => {
    const t = index / (count - 1);
    const angle = Math.PI - t * Math.PI;
    return { x: Math.cos(angle) * radius, y: -Math.sin(angle) * radius };
  });
}

export function slotIndexAt(
  x: number,
  y: number,
  positions: WheelSlotPosition[] = wheelSlotPositions()
): number | null {
  const distanceFromCentre = Math.hypot(x, y);
  if (distanceFromCentre < TILE_DEAD_ZONE) return null;
  let best: { index: number; dist: number } | null = null;
  for (let i = 0; i < positions.length; i += 1) {
    const dist = Math.hypot(x - positions[i].x, y - positions[i].y);
    if (dist > SLOT_HIT_RADIUS) continue;
    if (!best || dist < best.dist) best = { index: i, dist };
  }
  return best?.index ?? null;
}
