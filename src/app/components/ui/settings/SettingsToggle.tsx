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
      <input
        id={id}
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`w-3 h-3 rounded border-white/10 bg-black/40 text-primary focus:ring-primary/50 ${
          danger ? 'text-red-500 focus:ring-red-500/50' : ''
        }`}
      />
    </label>
  );
}
