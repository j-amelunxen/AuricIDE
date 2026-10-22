'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { acceleratorFromKeyEvent, formatAccelerator } from '@/lib/quickAccess/supervisorMenuBar';

interface ShortcutRecorderProps {
  value: string | undefined;
  onChange: (accelerator: string | undefined) => void;
  ariaLabel: string;
  /** Another shortcut in the menu bar claims the same keys; only one can have them. */
  duplicate?: boolean;
}

/**
 * Records a global shortcut by pressing it. Focus the field, press the keys;
 * Backspace clears. Only combinations with Control, Option or Command count,
 * so a stray letter can never become a shortcut that swallows typing.
 */
export function ShortcutRecorder({ value, onChange, ariaLabel, duplicate }: ShortcutRecorderProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          readOnly
          aria-label={ariaLabel}
          aria-invalid={duplicate || undefined}
          value={value ? formatAccelerator(value) : ''}
          placeholder="Shortcut: click, then press keys"
          onKeyDown={(event) => {
            if (event.key === 'Tab') return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Backspace' || event.key === 'Delete') {
              onChange(undefined);
              return;
            }
            if (event.key === 'Escape') {
              event.currentTarget.blur();
              return;
            }
            const accelerator = acceleratorFromKeyEvent(event);
            if (accelerator) onChange(accelerator);
          }}
          className="w-full rounded bg-white/5 px-2 py-1.5 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary/40"
        />
        {value && (
          <button
            type="button"
            aria-label={`Clear ${ariaLabel.toLowerCase()}`}
            onClick={() => onChange(undefined)}
            className="rounded p-1 text-foreground-muted transition-colors hover:text-foreground"
          >
            <AuricIcon name="close" aria-hidden="true" className="text-[14px]" />
          </button>
        )}
      </div>
      {duplicate && (
        <p className="text-[10px] text-amber-400/80">
          Another shortcut uses these keys too; only the first one gets them.
        </p>
      )}
    </div>
  );
}
