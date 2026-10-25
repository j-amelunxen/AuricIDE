'use client';

import { useId, useState, type ReactNode } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

/** The quiet helper-text style every settings group shares. */
export const SETTINGS_HINT_CLASS = 'text-[11px] leading-relaxed text-foreground-muted';

/** The small heading of a group or a field block inside one. */
export const SETTINGS_LABEL_CLASS = 'text-[11px] font-semibold text-foreground';

interface LearnMoreProps {
  children: ReactNode;
  /** What the disclosure button says; "Learn more" by default. */
  label?: string;
  testId?: string;
}

/**
 * The long explanation behind one inline disclosure, so a group leads with one short
 * sentence and the detail is still a click away (never removed).
 */
export function LearnMore({ children, label = 'Learn more', testId }: LearnMoreProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        data-testid={testId}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex items-center gap-0.5 rounded text-[11px] text-primary-light transition-colors hover:text-foreground"
      >
        {label}
        <AuricIcon
          name="expand_more"
          aria-hidden="true"
          className={`text-[13px] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div id={id} hidden={!open} className={`space-y-1.5 ${SETTINGS_HINT_CLASS}`}>
        {children}
      </div>
    </div>
  );
}

interface SettingsRowProps {
  label: string;
  /** The id of the control, so the label names it. */
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}

/**
 * One setting as a line: label and hint on the left, the control on the right, the way a
 * settings list reads. Rows in a group line their controls up on the same edge.
 */
export function SettingsRow({ label, htmlFor, hint, children }: SettingsRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 border-t border-white/5 pt-3 first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block text-xs text-foreground">
          {label}
        </label>
        {hint && <p className={SETTINGS_HINT_CLASS}>{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

interface SettingsGroupProps {
  title?: string;
  /** One short sentence; anything longer belongs in `learnMore`. */
  description?: ReactNode;
  learnMore?: ReactNode;
  /** Shown at the right of the title line, e.g. a count or a status. */
  accessory?: ReactNode;
  children?: ReactNode;
  testId?: string;
}

/**
 * An inset panel that holds one group of related settings: one heading, one short
 * explanation, then the controls. Groups stack with the same spacing on every page.
 */
export function SettingsGroup({
  title,
  description,
  learnMore,
  accessory,
  children,
  testId,
}: SettingsGroupProps) {
  const headingId = useId();
  return (
    <section
      data-testid={testId}
      aria-labelledby={title ? headingId : undefined}
      className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
    >
      {(title || description || learnMore) && (
        <div className="space-y-1">
          {title && (
            <div className="flex items-center justify-between gap-3">
              <h4 id={headingId} className="text-xs font-semibold text-foreground">
                {title}
              </h4>
              {accessory}
            </div>
          )}
          {description && <div className={SETTINGS_HINT_CLASS}>{description}</div>}
          {learnMore && <LearnMore>{learnMore}</LearnMore>}
        </div>
      )}
      {children}
    </section>
  );
}
