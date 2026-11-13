import { hunkHeaderAttrs, hunkHeaderClass, useHunkHeader } from './HunkHeaderContext';
import { lineStyles } from './types';

/** A header row of the side-by-side view, with the owner's hunk controls when it is a hunk. */
export function HunkHeaderRow({ content, hunkIndex }: { content: string; hunkIndex?: number }) {
  const hunkHeader = useHunkHeader();
  return (
    <div
      data-hunk-index={hunkIndex}
      {...hunkHeaderAttrs(hunkHeader, hunkIndex)}
      className={`flex ${lineStyles.header} ${hunkHeaderClass(hunkHeader, hunkIndex)}`}
    >
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-4">{content}</span>
      {hunkHeader && hunkIndex !== undefined ? hunkHeader.renderHunkHeader(hunkIndex) : null}
    </div>
  );
}
