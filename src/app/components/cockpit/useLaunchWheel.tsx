'use client';

import { useEffect, useRef, useState } from 'react';
import {
  wheelEntryLabel,
  wheelEntryName,
  wheelSlotId,
  type WheelLaunchEntry,
} from '@/lib/quickAccess/launchSkills';
import {
  assignSkillToSlot,
  clearWheelSlot,
  normalizeWheelSlots,
  slotIndexAt,
  wheelSlotChoices,
} from '@/lib/quickAccess/wheel';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { SkillWheel, useSkillWheel } from './SkillWheel';

interface LaunchWheelOptions {
  /** Names the wheel in test ids — a project path, or `supervisor`. */
  wheelId: string;
  /** Everything the tile can launch, in wheel-plus order. */
  entries: WheelLaunchEntry[];
  /** The slots as stored; ids that no longer resolve are dropped here. */
  storedSlots: (string | null)[];
  writeSlots: (slots: (string | null)[]) => void;
  onLaunch: (entry: WheelLaunchEntry) => void;
  /** Where "Configure skills…" goes when there is nothing to assign yet. */
  onConfigure: () => void;
  /** Another tile's wheel is open; this one stays shut. */
  suppressed: boolean;
  onActivity: (active: boolean) => void;
}

type Picker = { slot: number; x: number; y: number; mode: 'assign' | 'manage' };

/**
 * The hover/hold skill wheel of a Quick Access tile, with its two slot menus:
 * 'assign' picks what goes on a slot, 'manage' acts on what is already there.
 * Both keep the wheel pinned open while they are up. Shared by project tiles
 * and the supervisor tile, so a wheel behaves the same wherever it opens.
 */
export function useLaunchWheel({
  wheelId,
  entries,
  storedSlots,
  writeSlots,
  onLaunch,
  onConfigure,
  suppressed,
  onActivity,
}: LaunchWheelOptions) {
  const { machine, dispatch } = useSkillWheel(suppressed);
  const tileRef = useRef<HTMLButtonElement>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const pickerHandover = useRef(false);

  const knownIds = entries.map(wheelSlotId);
  const slotIds = normalizeWheelSlots(storedSlots, knownIds);
  const byId = (id: string | null) =>
    id === null ? null : (entries.find((entry) => wheelSlotId(entry) === id) ?? null);
  const slotted = slotIds.map(byId);

  const wheelLive = machine.phase !== 'idle' || machine.mode !== 'none';
  // Hovering a tile does two things at once: it reveals the remove ×, and it
  // starts the wheel's dwell. Gating the × on "the wheel is doing something"
  // meant the dwell hid it from the first frame of every hover, and the wheel
  // opens 300ms in and never closes while the pointer rests there — so the ×
  // was unreachable by pointer, full stop. It now yields only to an actual
  // hold gesture, where a release could otherwise land on it by accident.
  const wheelGrabbed = machine.mode === 'hold';
  const onActivityRef = useRef(onActivity);
  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);
  useEffect(() => {
    onActivityRef.current(wheelLive);
  }, [wheelLive]);

  const aimFromPointer = (event: React.PointerEvent) => {
    const slotEl = (event.target as HTMLElement | null)?.closest?.('[data-wheel-slot]');
    if (slotEl instanceof HTMLElement && slotEl.dataset.wheelSlot !== undefined) {
      dispatch({ type: 'aim', slot: Number(slotEl.dataset.wheelSlot) });
      return;
    }
    const origin = tileRef.current;
    if (!origin) return;
    const rect = origin.getBoundingClientRect();
    dispatch({
      type: 'aim',
      slot: slotIndexAt(
        event.clientX - (rect.left + rect.width / 2),
        event.clientY - (rect.top + rect.height / 2)
      ),
    });
  };

  const launchSlot = (index: number) => {
    const entry = slotted[index];
    if (entry) onLaunch(entry);
  };

  const resolveChoices = (ids: { id: string }[]) =>
    ids
      .map((choice) => byId(choice.id))
      .filter((entry): entry is WheelLaunchEntry => entry !== null);

  const choices = picker
    ? wheelSlotChoices(
        entries.map((entry) => ({ id: wheelSlotId(entry), label: wheelEntryLabel(entry) })),
        slotIds,
        picker.slot
      )
    : { free: [], placed: [] };
  const freeEntries = resolveChoices(choices.free);
  const placedEntries = resolveChoices(choices.placed);

  const entryOption = (entry: WheelLaunchEntry): ContextMenuOption => ({
    label: wheelEntryLabel(entry),
    icon: entry.kind === 'combo' ? 'account_tree' : 'auto_awesome',
    action: () => {
      if (picker) writeSlots(assignSkillToSlot(slotIds, picker.slot, wheelSlotId(entry), knownIds));
    },
  });

  const assignMenuOptions = (): ContextMenuOption[] => {
    if (freeEntries.length === 0 && placedEntries.length === 0) {
      return [
        {
          label: entries.length === 0 ? 'Configure skills…' : 'Nothing left to put here',
          icon: 'settings',
          action: () => {
            if (entries.length === 0) onConfigure();
          },
        },
      ];
    }
    const combos = freeEntries.filter((entry) => entry.kind === 'combo');
    const skills = freeEntries.filter((entry) => entry.kind === 'skill');
    const options: ContextMenuOption[] = [];
    if (combos.length > 0) {
      options.push({ type: 'header', label: 'Combos' }, ...combos.map(entryOption));
    }
    if (combos.length > 0 && skills.length > 0) {
      options.push({ type: 'separator' });
    }
    if (skills.length > 0) {
      options.push({ type: 'header', label: 'Skills' }, ...skills.map(entryOption));
    }
    // Moving one here empties the slot it came from — or swaps, if this slot is
    // taken. Either way nothing is lost, so it sits in the same list.
    if (placedEntries.length > 0) {
      if (options.length > 0) options.push({ type: 'separator' });
      options.push(
        { type: 'header', label: 'Already on the wheel' },
        ...placedEntries.map(entryOption)
      );
    }
    return options;
  };

  const manageMenuOptions = (): ContextMenuOption[] => {
    const entry = picker ? slotted[picker.slot] : null;
    if (!entry || !picker) return [];
    return [
      { type: 'header', label: wheelEntryName(entry) },
      {
        label: 'Replace with…',
        icon: 'move_item',
        action: () => {
          pickerHandover.current = true;
          setPicker({ ...picker, mode: 'assign' });
        },
      },
      {
        label: 'Take off the wheel',
        icon: 'close',
        danger: true,
        action: () => writeSlots(clearWheelSlot(slotIds, picker.slot, knownIds)),
      },
    ];
  };

  /** Pointer handlers for the tile's outer element. */
  const containerHandlers = {
    onPointerEnter: (event: React.PointerEvent) =>
      dispatch({ type: 'enter', now: event.timeStamp }),
    onPointerMove: (event: React.PointerEvent) => {
      if (machine.mode === 'hold' && machine.phase === 'open') {
        aimFromPointer(event);
        return;
      }
      // A menu that closed while the pointer sat on the tile leaves no enter
      // to come — without this the wheel would stay shut until the pointer
      // crossed the boundary again.
      if (machine.mode === 'none') dispatch({ type: 'enter', now: event.timeStamp });
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (picker) return;
      dispatch({ type: 'leave', now: event.timeStamp });
    },
  };

  /** Pointer handlers for the tile's own button, which owns pointer capture. */
  const buttonHandlers = {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      dispatch({ type: 'down', now: event.timeStamp });
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (machine.mode === 'hold' && machine.phase === 'open') aimFromPointer(event);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const action = dispatch({ type: 'up', now: event.timeStamp });
      if (action.type === 'hold-release' && action.slot !== null) launchSlot(action.slot);
    },
    onPointerCancel: () => dispatch({ type: 'cancel' }),
  };

  const wheel = (
    <SkillWheel
      path={wheelId}
      phase={machine.phase}
      mode={machine.mode}
      armedSlot={machine.armedSlot}
      slots={slotted}
      onSlotClick={launchSlot}
      onPlusClick={(index, x, y) => setPicker({ slot: index, x, y, mode: 'assign' })}
      onSlotManage={(index, x, y) => setPicker({ slot: index, x, y, mode: 'manage' })}
    />
  );

  const pickerMenu = picker && (
    <ContextMenu
      // Keyed by mode: swapping the manage menu for the assign one is a new
      // menu, and it has to take focus like one.
      key={picker.mode}
      x={picker.x}
      y={picker.y}
      onClose={() => {
        // ContextMenu closes itself after every action, including the one
        // that only swaps this menu for the other — that swap is not a close.
        if (pickerHandover.current) {
          pickerHandover.current = false;
          return;
        }
        setPicker(null);
        // Reaching the menu already fired the tile's leave, and that one was
        // swallowed to hold the wheel open. Hand it back now, or the wheel
        // has no way left to close.
        dispatch({ type: 'leave', now: performance.now() });
      }}
      options={picker.mode === 'manage' ? manageMenuOptions() : assignMenuOptions()}
    />
  );

  return {
    tileRef,
    dispatch,
    wheelLive,
    wheelGrabbed,
    /** A hold just ended on this tile; the click that follows is not a click. */
    consumedClick: machine.consumedClick,
    containerHandlers,
    buttonHandlers,
    wheel,
    pickerMenu,
  };
}
