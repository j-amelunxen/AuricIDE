import { getGlyph } from './registry';
import type { IconPrimitive } from './types';

function primitiveMarkup(prim: IconPrimitive): string {
  const style =
    'accent' in prim && prim.accent
      ? ' fill="var(--primary)" stroke="none"'
      : 'fill' in prim && prim.fill
        ? ' fill="currentColor" stroke="none"'
        : '';
  switch (prim.kind) {
    case 'path':
      return `<path d="${prim.d}"${style}/>`;
    case 'circle':
      return `<circle cx="${prim.cx}" cy="${prim.cy}" r="${prim.r}"${style}/>`;
    case 'rect':
      return `<rect x="${prim.x}" y="${prim.y}" width="${prim.w}" height="${prim.h}" rx="${prim.rx ?? 0}"${style}/>`;
    case 'line':
      return `<line x1="${prim.x1}" y1="${prim.y1}" x2="${prim.x2}" y2="${prim.y2}"${style}/>`;
  }
}

/**
 * String renderer for contexts that build raw DOM/HTML instead of React
 * (CodeMirror completion entries, tooltips). Same output contract as
 * AuricIcon: 1em box, currentColor line work, var(--primary) accent.
 */
export function iconSvgMarkup(name: string, className = ''): string {
  const glyph = getGlyph(name);
  const cls = className ? `auric-icon ${className}` : 'auric-icon';
  const body = glyph ? glyph.map(primitiveMarkup).join('') : '';
  return (
    `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" data-icon="${name}" ` +
    `aria-hidden="true" class="${cls}">${body}</svg>`
  );
}
