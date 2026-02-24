import type { PmTicket, PmEpic } from '../tauri/pm';

export function generateDependencyProposalPrompt(
  ticket: PmTicket,
  epic: PmEpic,
  allTicketsInEpic: PmTicket[]
): string {
  const otherTickets = allTicketsInEpic.filter((t) => t.id !== ticket.id);

  let prompt = `You are a technical project manager assistant. Your task is to identify potential technical dependencies between tickets within the same Epic.

Current Ticket:
- Name: ${ticket.name}
- Description: ${ticket.description}

Epic:
- Name: ${epic.name}
- Description: ${epic.description || 'No description'}

Other Tickets in this Epic:
`;

  otherTickets.forEach((t, i) => {
    prompt += `${i + 1}. Ticket ID: ${t.id}
   - Name: ${t.name}
   - Description: ${t.description}
`;
  });

  prompt += `
Based on the descriptions, identify which of the "Other Tickets" must be completed BEFORE the "Current Ticket" can be implemented.

Respond ONLY with a JSON array of objects, each containing:
- "id": the ID of the dependency ticket
- "reason": a short explanation of why this is a dependency

Example:
[
  { "id": "uuid-1", "reason": "Requires the database schema defined in this ticket." },
  { "id": "uuid-2", "reason": "Needs the API endpoint implemented here." }
]

If no dependencies are found, respond with an empty array [].
Do NOT include any other text in your response.`;

  return prompt;
}

export interface DependencySuggestion {
  id: string;
  reason: string;
}

export function parseDependencyResponse(content: string): DependencySuggestion[] {
  try {
    const start = content.indexOf('[');
    const end = content.lastIndexOf(']') + 1;
    if (start === -1 || end === 0) return [];
    const jsonStr = content.substring(start, end);
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('Failed to parse dependency response:', err);
    return [];
  }
}
