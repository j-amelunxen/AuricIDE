/**
 * A visible key hint. Hidden from assistive technology: the control it
 * belongs to carries `aria-keyshortcuts`, which is what a screen reader reads.
 */
export function Kbd({ children }: { children: string }) {
  return (
    <kbd
      aria-hidden="true"
      className="rounded border border-white/15 bg-white/5 px-1 font-mono text-[10px] leading-4 text-foreground"
    >
      {children}
    </kbd>
  );
}
