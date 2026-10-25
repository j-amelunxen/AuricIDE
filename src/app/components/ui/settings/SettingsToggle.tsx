import { useId } from 'react';
import { InfoTooltip } from '../InfoTooltip';
import { SettingsSwitch } from './SettingsSwitch';

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
      <SettingsSwitch
        id={id}
        checked={checked}
        onChange={onChange}
        danger={danger}
        testId={testId}
        switchRole={false}
      />
    </label>
  );
}
