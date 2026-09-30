interface ToggleGroupProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** A row of real buttons where exactly one is pressed. */
export function ToggleGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: ToggleGroupProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <span className="mr-1 text-[10px] text-foreground-muted">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
            value === option.value
              ? 'bg-white/15 text-white'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
