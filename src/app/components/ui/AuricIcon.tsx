import React from 'react';
import { getGlyph } from '@/lib/icons/registry';
import type { IconPrimitive } from '@/lib/icons/types';

const warned = new Set<string>();

function primitiveProps(prim: IconPrimitive) {
  if ('accent' in prim && prim.accent) {
    return { fill: 'var(--primary)', stroke: 'none' } as const;
  }
  if ('fill' in prim && prim.fill) {
    return { fill: 'currentColor', stroke: 'none' } as const;
  }
  return {};
}

function renderPrimitive(prim: IconPrimitive, key: number) {
  const props = primitiveProps(prim);
  switch (prim.kind) {
    case 'path':
      return <path key={key} d={prim.d} {...props} />;
    case 'circle':
      return <circle key={key} cx={prim.cx} cy={prim.cy} r={prim.r} {...props} />;
    case 'rect':
      return (
        <rect key={key} x={prim.x} y={prim.y} width={prim.w} height={prim.h} rx={prim.rx} {...props} />
      );
    case 'line':
      return <line key={key} x1={prim.x1} y1={prim.y1} x2={prim.x2} y2={prim.y2} {...props} />;
  }
}

export interface AuricIconProps extends React.SVGProps<SVGSVGElement> {
  /** Glyph name — the Material ligature vocabulary (e.g. "folder", "task_alt"). */
  name: string;
  /** Accessible label. Without it the icon is decorative (aria-hidden). */
  title?: string;
}

/**
 * AuricIDE's in-house icon renderer ("Auric Line" set). Inline SVG so the
 * line work follows `currentColor` and the single accent primitive follows
 * `var(--primary)` — icons re-theme live when the user switches the accent.
 * Sized 1em×1em: existing font-size utilities keep controlling icon size.
 */
export function AuricIcon({ name, title, className, ...rest }: AuricIconProps) {
  const glyph = getGlyph(name);
  if (!glyph && process.env.NODE_ENV !== 'production' && !warned.has(name)) {
    warned.add(name);
    console.warn(`[AuricIcon] no glyph registered for "${name}"`);
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={name}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className={className ? `auric-icon ${className}` : 'auric-icon'}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {glyph?.map(renderPrimitive)}
    </svg>
  );
}
