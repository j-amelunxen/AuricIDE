/**
 * One keyboard-shortcut hint: a `kbd` chip plus what it does. Shared by the
 * compact capture bar (one hint, "⏎ Add") and the Spotlight overlay (two,
 * "⏎ Add and close" / "⇧⏎ Add and keep capturing") so the two never drift
 * into two different visual languages for the same idea.
 */
export function KbdHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded bg-white/5 px-1 font-mono">{keys}</kbd> {label}
    </span>
  );
}
