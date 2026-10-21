import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { GitRef } from '@/lib/tauri/gitGraph';

interface RefPillProps {
  gitRef: GitRef;
  /** The lane colour of the commit the pill sits on. */
  color: string;
  onContextMenu?: (event: React.MouseEvent) => void;
}

const BASE =
  'inline-flex h-[18px] min-w-0 max-w-[11rem] shrink-0 items-center gap-1 rounded-full px-2 text-[11px] leading-none';

function pillStyle(kind: GitRef['kind'], color: string): React.CSSProperties {
  if (kind === 'local') return { backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)` };
  if (kind === 'remote')
    return { boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 85%, transparent)` };
  if (kind === 'head') return { boxShadow: 'inset 0 0 0 1.5px var(--primary)' };
  return {};
}

const TONE: Record<GitRef['kind'], string> = {
  local: 'text-foreground',
  remote: 'text-foreground-muted',
  tag: 'bg-white/10 text-foreground-muted',
  head: 'text-primary-light',
};

/** A capsule for one ref: filled for local, outlined for remote, a tag glyph for tags. */
export function RefPill({ gitRef, color, onContextMenu }: RefPillProps) {
  return (
    <span
      className={`${BASE} ${TONE[gitRef.kind]} ${gitRef.isCurrent ? 'font-semibold' : 'font-medium'}`}
      style={pillStyle(gitRef.kind, color)}
      title={gitRef.name}
      onContextMenu={onContextMenu}
    >
      {gitRef.isCurrent && (
        <AuricIcon name="check" aria-hidden="true" className="shrink-0 text-[11px]" />
      )}
      {gitRef.kind === 'tag' && (
        <AuricIcon name="sell" aria-hidden="true" className="shrink-0 text-[11px]" />
      )}
      <span className="truncate">{gitRef.shorthand}</span>
    </span>
  );
}
