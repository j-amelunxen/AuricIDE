import { useId } from 'react';

interface SettingsInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  testId?: string;
}

export function SettingsInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  mono = false,
  testId,
}: SettingsInputProps) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs text-foreground">
        {label}
      </label>
      <input
        id={id}
        data-testid={testId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded border border-border-dark bg-editor-bg px-2 py-1.5 text-xs text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none ${
          mono ? 'font-mono' : ''
        }`}
      />
      {hint && <span className="text-[9px] text-foreground-muted opacity-60">{hint}</span>}
    </div>
  );
}
