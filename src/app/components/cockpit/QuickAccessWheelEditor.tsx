'use client';

import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import {
  wheelEntryLabel,
  wheelEntryName,
  wheelSlotId,
  type WheelLaunchEntry,
} from '@/lib/quickAccess/launchSkills';
import {
  WHEEL_SLOT_COUNT,
  assignSkillToSlot,
  clearWheelSlot,
  normalizeWheelSlots,
  skillMark,
  wheelSlotChoices,
  wheelSlotPositions,
} from '@/lib/quickAccess/wheel';

/** Wider than the live wheel: a dialog has the room, and 6 labels need it. */
const EDITOR_RADIUS = 96;
/** Half a slot plus its label, so the topmost slot is not clipped. */
const ARC_HEADROOM = 26;

interface QuickAccessWheelEditorProps {
  /** Everything this project could launch — drafts included. */
  entries: WheelLaunchEntry[];
  slots: (string | null)[];
  onChange: (slots: (string | null)[]) => void;
  onAnnounce: (message: string) => void;
}

/**
 * The wheel as a page, not a gesture. The live wheel needs a steady hand and a
 * mouse; this is the same six slots laid out flat, reachable by tab, and the
 * only place the whole arrangement can be seen at once.
 */
export function QuickAccessWheelEditor({
  entries,
  slots,
  onChange,
  onAnnounce,
}: QuickAccessWheelEditorProps) {
  const [selected, setSelected] = useState(0);

  const knownIds = entries.map(wheelSlotId);
  // Normalised on the way in: the skills list next to this one is a draft, so a
  // slot can be pointing at something the user deleted a moment ago.
  const current = normalizeWheelSlots(slots, knownIds);
  const entryFor = (id: string | null) =>
    id === null ? null : (entries.find((entry) => wheelSlotId(entry) === id) ?? null);

  const positions = wheelSlotPositions(WHEEL_SLOT_COUNT, EDITOR_RADIUS);
  const choices = wheelSlotChoices(
    entries.map((entry) => ({ id: wheelSlotId(entry), label: wheelEntryLabel(entry) })),
    current,
    selected
  );
  const occupant = entryFor(current[selected]);

  const assign = (id: string) => {
    const entry = entryFor(id);
    onChange(assignSkillToSlot(current, selected, id, knownIds));
    onAnnounce(`${entry ? wheelEntryName(entry) : id} on slot ${selected + 1}`);
  };

  const clear = () => {
    onChange(clearWheelSlot(current, selected, knownIds));
    onAnnounce(`Slot ${selected + 1} emptied`);
  };

  const choiceButton = (choice: { id: string; label: string }, fromSlot: number | null) => {
    const entry = entryFor(choice.id);
    return (
      <button
        key={choice.id}
        type="button"
        data-testid={`wheel-editor-choice-${choice.id}`}
        onClick={() => assign(choice.id)}
        className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-foreground-muted transition-colors hover:bg-primary/15 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        <AuricIcon
          name={entry?.kind === 'combo' ? 'account_tree' : 'auto_awesome'}
          aria-hidden="true"
          className="text-[12px]"
        />
        <span className="max-w-40 truncate">{choice.label}</span>
        {fromSlot !== null && (
          <span className="text-[9px] text-foreground-muted/60">from slot {fromSlot + 1}</span>
        )}
      </button>
    );
  };

  return (
    <SettingsSection title="Wheel" icon="hub">
      <p className="text-[10px] leading-relaxed text-foreground-muted/70">
        What sits around the tile when you hover or hold it. Slot positions stay put, so pick one
        and leave it there. In the wheel itself, right-click a slot to move or remove it.
      </p>

      <div
        data-testid="quick-access-wheel-editor"
        className="relative mx-auto w-full"
        style={{ height: EDITOR_RADIUS + ARC_HEADROOM * 2 }}
      >
        {positions.map((pos, index) => {
          const entry = entryFor(current[index]);
          const active = index === selected;
          return (
            <button
              key={index}
              type="button"
              data-testid={`wheel-editor-slot-${index}`}
              data-filled={entry !== null}
              aria-pressed={active}
              aria-label={
                entry ? `Slot ${index + 1}: ${wheelEntryName(entry)}` : `Slot ${index + 1}: empty`
              }
              onClick={() => setSelected(index)}
              className="absolute flex w-16 flex-col items-center gap-1"
              style={{
                left: '50%',
                top: EDITOR_RADIUS + ARC_HEADROOM,
                transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`,
              }}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-bold transition-colors ${
                  entry
                    ? entry.kind === 'combo'
                      ? 'bg-primary/20 text-foreground ring-1 ring-primary/45'
                      : 'bg-background text-foreground ring-1 ring-white/20'
                    : 'bg-background/60 text-foreground-muted/60 ring-1 ring-dashed ring-white/20'
                } ${active ? 'ring-2 ring-primary' : ''}`}
              >
                {entry ? skillMark(wheelEntryName(entry)) : index + 1}
              </span>
              <span
                className={`max-w-full truncate text-[9px] leading-none ${
                  active ? 'text-foreground' : 'text-foreground-muted/70'
                }`}
              >
                {entry ? wheelEntryName(entry) : 'Empty'}
              </span>
            </button>
          );
        })}
        {/* The tile the arc belongs to — without it the semicircle floats. */}
        <span
          aria-hidden="true"
          className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white/5 ring-1 ring-white/10"
          style={{ left: '50%', top: EDITOR_RADIUS + ARC_HEADROOM }}
        />
      </div>

      <div className="space-y-2 rounded-lg bg-white/[0.03] p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted/60">
          Slot {selected + 1}
          {occupant ? `: ${wheelEntryName(occupant)}` : ''}
        </p>
        {entries.length === 0 ? (
          <p className="text-[11px] text-foreground-muted/70">
            Add a skill or a combo above, then it can go on the wheel.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {occupant && (
              <button
                type="button"
                data-testid="wheel-editor-clear"
                onClick={clear}
                className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-red-400/90 transition-colors hover:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              >
                <AuricIcon name="close" aria-hidden="true" className="text-[12px]" />
                Empty this slot
              </button>
            )}
            {choices.free.map((choice) => choiceButton(choice, null))}
            {choices.placed.map((choice) => choiceButton(choice, current.indexOf(choice.id)))}
            {choices.free.length === 0 && choices.placed.length === 0 && (
              <p className="text-[11px] text-foreground-muted/70">
                Everything configured is already on the wheel.
              </p>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
