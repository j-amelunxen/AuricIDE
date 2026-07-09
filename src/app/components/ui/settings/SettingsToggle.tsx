import { useId } from 'react';
import { InfoTooltip } from '../InfoTooltip';

interface SettingsToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  tooltip?: string;
  danger?: boolean;
  testId?: string;
}

export function SettingsToggle({
  label,
  description,
  checked,
  onChange,
  tooltip,
  danger = false,
  testId,
}: SettingsToggleProps) {
  const id = useId();

  return (
    <label htmlFor={id} className="flex items-center justify-between group cursor-pointer">
      <div className="flex flex-col gap-0.5">
        <span
          className={`flex items-center text-xs text-foreground group-hover:text-primary-light transition-colors ${
            danger ? 'group-hover:text-red-400' : ''
          }`}
        >
          {label}
          {tooltip && <InfoTooltip description={tooltip} label="i" />}
        </span>
        {description && (
          <span className="text-[9px] text-foreground-muted opacity-60">{description}</span>
        )}
      </div>
      <span className="relative inline-flex h-4 w-7 flex-shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
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
    </label>
  );
}
