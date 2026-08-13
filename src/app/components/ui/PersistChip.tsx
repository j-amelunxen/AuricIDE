'use client';

export function PersistChip({ dirty, mode }: { dirty?: boolean; mode?: 'draft' | 'autosaved' }) {
  const resolved = mode === 'autosaved' ? 'autosaved' : dirty ? 'unsaved' : null;
  if (!resolved) return null;

  return (
    <span
      data-testid="persist-chip"
      className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium tabular-nums text-foreground-muted"
    >
      {resolved === 'autosaved' ? 'Autosaved' : 'Unsaved · ⌘S'}
    </span>
  );
}
