interface SettingsSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Ties the switch to a visible `<label htmlFor>`; give `ariaLabel` instead when there is none. */
  id?: string;
  ariaLabel?: string;
  danger?: boolean;
  testId?: string;
  /** Announce it as a switch. Off only where callers already find it as a checkbox. */
  switchRole?: boolean;
}

/**
 * The on-brand switch on its own, for rows whose label is not a plain line of text (a list
 * row with a disclosure, say). `SettingsToggle` is this switch plus a label and description.
 */
// code-gate: complexity-parameter-count - one props object; each prop is a named field, not a positional parameter
export function SettingsSwitch({
  checked,
  onChange,
  id,
  ariaLabel,
  danger = false,
  testId,
  switchRole = true,
}: SettingsSwitchProps) {
  return (
    <span className="relative inline-flex h-4 w-7 flex-shrink-0 items-center">
      <input
        id={id}
        type="checkbox"
        role={switchRole ? 'switch' : undefined}
        aria-label={ariaLabel}
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      {/* Custom switch track — native checkbox styling ignores theme tokens,
          so we render an on-brand track/thumb driven by the checked prop. */}
      <span
        aria-hidden="true"
        className={`h-4 w-7 rounded-full transition-colors duration-150 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[rgba(var(--primary-light-rgb),0.7)] ${
          checked ? (danger ? 'bg-red-500' : 'bg-primary') : 'bg-white/15'
        }`}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? 'translate-x-3' : 'translate-x-0'
        }`}
      />
    </span>
  );
}
