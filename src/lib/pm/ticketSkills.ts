/**
 * Skills attached to a ticket are stored as their invocations
 * (`/tdd`, `/frontend:component`). That is also what the agent CLIs read:
 * the invocations are written in front of the prompt, then the task itself.
 */

export function normalizeTicketSkills(skills: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of skills ?? []) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const invocation = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    if (seen.has(invocation)) continue;
    seen.add(invocation);
    out.push(invocation);
  }
  return out;
}

export function ticketSkillPrefix(skills: readonly string[] | undefined): string {
  return normalizeTicketSkills(skills).join(' ');
}

/**
 * Write the ticket's skills in front of an already-built prompt.
 *
 * Idempotent on the same prefix so a dialog that already showed the skills
 * and a later spawn of the same ticket do not stack `/tdd /tdd`.
 */
export function prependTicketSkills(skills: readonly string[] | undefined, prompt: string): string {
  const prefix = ticketSkillPrefix(skills);
  if (!prefix) return prompt;
  if (prompt === prefix || prompt.startsWith(`${prefix}\n`) || prompt.startsWith(`${prefix} `)) {
    return prompt;
  }
  return `${prefix}\n\n${prompt}`;
}
