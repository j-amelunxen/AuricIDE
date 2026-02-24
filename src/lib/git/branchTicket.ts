/**
 * Extract a ticket ID from a branch name using a configurable regex pattern.
 * The pattern must contain a capture group — the first group match is returned.
 */
export function extractTicket(branch: string, pattern: string): string | null {
  if (!branch || !pattern) return null;
  try {
    const match = branch.match(new RegExp(pattern));
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Replace `{ticket}` and `{branch}` placeholders in a command template.
 * - `{ticket}` → extracted ticket ID (or empty string if no match)
 * - `{branch}` → full branch name
 */
export function resolveCommandTemplate(command: string, branch: string, pattern: string): string {
  const ticket = extractTicket(branch, pattern) ?? '';
  return command.replaceAll('{ticket}', ticket).replaceAll('{branch}', branch);
}
