/**
 * What a capture bar is allowed to submit: trimmed, non-empty text. Shared by
 * the sidebar capture bar and the Spotlight-style overlay so the two can
 * never disagree about whether "   " is a task.
 */
export function trimmedCaptureTitle(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}
