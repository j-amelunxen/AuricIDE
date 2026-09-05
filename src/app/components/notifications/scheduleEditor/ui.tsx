'use client';

import type React from 'react';

export const INPUT =
  'w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/40';

export const SUBLABEL =
  'mb-1 block font-mono text-[9px] uppercase tracking-wider text-foreground-muted/70';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2.5 block">
      <span className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-foreground-muted/70">
        {label}
      </span>
      {children}
    </label>
  );
}

export function Choice({
  testId,
  label,
  checked,
  disabled,
  onSelect,
  name = 'schedule-action',
}: {
  testId: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** Which radio group this belongs to — the Action fieldset by default. */
  name?: string;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-[11px] ${
        disabled ? 'cursor-not-allowed text-foreground-muted/50' : 'text-foreground'
      }`}
    >
      <input
        type="radio"
        name={name}
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      {label}
    </label>
  );
}
