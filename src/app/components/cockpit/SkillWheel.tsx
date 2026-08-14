'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DWELL_DOTS_MS,
  DWELL_LEAVE_GRACE_MS,
  DWELL_OPEN_MS,
  HOLD_OPEN_MS,
  createWheelMachine,
  reduceWheel,
  skillMark,
  wheelSlotPositions,
  type WheelMachine,
  type WheelAction,
  type WheelEvent,
} from '@/lib/quickAccess/wheel';
import {
  wheelEntryLabel,
  wheelEntryName,
  type WheelLaunchEntry,
} from '@/lib/quickAccess/launchSkills';

export function useSkillWheel(suppressed: boolean): {
  machine: WheelMachine;
  dispatch: (event: WheelEvent) => WheelAction;
} {
  const [machine, setMachine] = useState(createWheelMachine);
  const machineRef = useRef<WheelMachine | null>(null);

  const dispatch = (event: WheelEvent): WheelAction => {
    const current = machineRef.current ?? machine;
    const result = reduceWheel(current, event);
    machineRef.current = result.state;
    setMachine(result.state);
    return result.action;
  };

  useEffect(() => {
    if (!suppressed) return;
    const current = machineRef.current;
    if (!current || (current.phase === 'idle' && current.mode === 'none')) return;
    machineRef.current = createWheelMachine();
    setMachine(machineRef.current);
  }, [suppressed]);

  useEffect(() => {
    let delay: number | null = null;
    let tickAt: number | null = null;
    if (machine.leaveAt !== null && machine.mode !== 'hold') {
      delay = DWELL_LEAVE_GRACE_MS;
      tickAt = machine.leaveAt + DWELL_LEAVE_GRACE_MS;
    } else if (machine.mode === 'dwell' && machine.startedAt !== null && machine.phase !== 'open') {
      if (machine.phase === 'dots') {
        delay = DWELL_OPEN_MS - DWELL_DOTS_MS;
        tickAt = machine.startedAt + DWELL_OPEN_MS;
      } else {
        delay = DWELL_DOTS_MS;
        tickAt = machine.startedAt + DWELL_DOTS_MS;
      }
    } else if (machine.mode === 'hold' && machine.phase !== 'open' && machine.startedAt !== null) {
      delay = HOLD_OPEN_MS;
      tickAt = machine.startedAt + HOLD_OPEN_MS;
    }
    if (delay === null || tickAt === null) return;
    const id = window.setTimeout(() => {
      dispatch({ type: 'tick', now: tickAt });
    }, delay);
    return () => window.clearTimeout(id);
    // dispatch is recreated each render; the timeout reads the ref inside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [machine]);

  return { machine, dispatch };
}

interface SkillWheelProps {
  path: string;
  phase: WheelMachine['phase'];
  mode: WheelMachine['mode'];
  armedSlot: number | null;
  slots: (WheelLaunchEntry | null)[];
  onSlotClick: (index: number) => void;
  onPlusClick: (index: number, clientX: number, clientY: number) => void;
  /** Right-click on a filled slot: manage what sits there instead of launching it. */
  onSlotManage: (index: number, clientX: number, clientY: number) => void;
}

export function SkillWheel({
  path,
  phase,
  mode,
  armedSlot,
  slots,
  onSlotClick,
  onPlusClick,
  onSlotManage,
}: SkillWheelProps) {
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [showAllLabels, setShowAllLabels] = useState(false);
  const phaseRef = useRef(phase);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift' && phaseRef.current === 'open') setShowAllLabels(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShowAllLabels(false);
    };
    const onWindowBlur = () => setShowAllLabels(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, []);

  if (phase === 'idle') return null;
  const positions = wheelSlotPositions();
  const open = phase === 'open';

  return (
    <div
      data-testid={`quick-access-wheel-${path}`}
      data-phase={phase}
      data-mode={mode}
      className="pointer-events-none absolute left-1/2 top-1/2 z-30"
    >
      {positions.map((pos, index) => {
        const entry = slots[index] ?? null;
        const combo = entry?.kind === 'combo';
        const armed = armedSlot === index;
        const label = entry ? wheelEntryLabel(entry) : 'Add skill';
        const active = open && activeSlot === index;
        const labelPosition =
          pos.y < 0 && pos.x > 0
            ? {
                transform: `translate(${pos.x + 12}px, ${pos.y - 18}px) translateY(-100%)`,
              }
            : pos.y < 0 && pos.x < 0
              ? {
                  transform: `translate(${pos.x - 12}px, ${pos.y - 18}px) translate(-100%, -100%)`,
                }
              : pos.x > 0
                ? {
                    transform: `translate(${pos.x + 14}px, ${pos.y}px) translateY(-50%)`,
                  }
                : pos.x < 0
                  ? {
                      transform: `translate(${pos.x - 14}px, ${pos.y}px) translate(-100%, -50%)`,
                    }
                  : {
                      transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y * 1.45}px)`,
                    };
        return (
          <span key={index}>
            <button
              type="button"
              data-testid={`quick-access-wheel-slot-${path}-${index}`}
              data-wheel-slot={index}
              data-kind={entry?.kind ?? 'empty'}
              aria-label={label}
              disabled={!open}
              onPointerEnter={() => setActiveSlot(index)}
              onPointerLeave={() =>
                setActiveSlot((current) => (current === index ? null : current))
              }
              onFocus={() => setActiveSlot(index)}
              onBlur={() => setActiveSlot((current) => (current === index ? null : current))}
              onClick={(event) => {
                event.stopPropagation();
                if (mode === 'hold') return;
                if (entry) onSlotClick(index);
                else onPlusClick(index, event.clientX, event.clientY);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                // An empty slot has nothing to manage — its plus already is the
                // one thing a right-click could offer.
                if (entry) onSlotManage(index, event.clientX, event.clientY);
                else onPlusClick(index, event.clientX, event.clientY);
              }}
              className={`skill-wheel-slot pointer-events-auto absolute flex items-center justify-center ${
                open ? 'h-8 w-8' : 'h-2 w-2'
              } ${armed && open ? 'z-10' : ''}`}
              style={{
                transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`,
              }}
            >
              <span
                className={`relative flex items-center justify-center rounded-full shadow-sm transition-[transform,box-shadow,color,background-color] duration-150 ease-out ${
                  open
                    ? `h-8 w-8 text-[11px] font-bold ${
                        combo
                          ? 'bg-primary/20 text-foreground ring-1 ring-primary/45'
                          : entry
                            ? 'bg-background text-foreground ring-1 ring-white/20'
                            : 'bg-background/80 text-foreground-muted ring-1 ring-dashed ring-white/25'
                      } ${armed ? 'ring-2 ring-primary/80' : ''} ${
                        active ? 'scale-110 shadow-[0_0_14px_rgba(var(--primary-rgb),0.2)]' : ''
                      }`
                    : 'h-1.5 w-1.5 bg-white/55'
                }`}
              >
                {open ? (entry ? skillMark(wheelEntryName(entry)) : '+') : null}
                {open && combo && (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-primary text-[8px] font-black leading-none text-white"
                  >
                    +
                  </span>
                )}
              </span>
            </button>
            {open && (active || showAllLabels) && (
              <span
                data-testid={`quick-access-wheel-label-${path}-${index}`}
                aria-hidden="true"
                className="pointer-events-none absolute z-20 max-w-28 truncate rounded-md border border-white/10 bg-background-dark/95 px-2 py-1 text-[10px] font-semibold leading-none tracking-[0.01em] text-foreground shadow-lg"
                style={labelPosition}
              >
                {label}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
