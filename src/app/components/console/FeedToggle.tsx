'use client';

export interface FeedToggleOption<T extends string> {
  key: T;
  label: string;
}

export interface FeedToggleProps<T extends string> {
  options: readonly FeedToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * A small pressed-state button group — the feed header's mode switch
 * (Activity / All output) and its kind filter (All / Questions / Changes /
 * Completions) are the same shape, so they share this one rendering.
 */
export function FeedToggle<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: FeedToggleProps<T>) {
  return (
    <div className={`flex gap-0.5 ${className}`}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
            value === option.key
              ? 'bg-white/10 text-foreground'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
