import type { PmTicket, PmTestCase, PmDependency } from '../tauri/pm';

export interface AvailableItem {
  id: string;
  type: 'epic' | 'ticket';
  name: string;
  status?: string;
}

export async function generateTicketPrompt(
  ticket: PmTicket,
  testCases: PmTestCase[],
  dependencies: PmDependency[],
  availableItems: AvailableItem[],
  rootPath?: string | null
): Promise<string> {
  let task = `Implementation of ticket: ${ticket.name}

`;
  task += `Description:
${ticket.description}

`;

  task += `Priority: ${ticket.priority.toUpperCase()}

`;

  if (ticket.modelPower) {
    task += `Model Power Recommended: ${ticket.modelPower.toUpperCase()}
(This is an indicator of the complexity and required reasoning capabilities for this ticket)

`;
  }

  if (ticket.context && ticket.context.length > 0) {
    task += `Additional Context:
`;
    for (const item of ticket.context) {
      if (item.type === 'snippet') {
        task += `--- Snippet ---
${item.value}

`;
      } else if (item.type === 'file') {
        task += `--- File: ${item.value} ---
`;
        try {
          const fs = await import('@tauri-apps/plugin-fs');
          const path = await import('@tauri-apps/api/path');
          const fullPath = rootPath ? await path.join(rootPath, item.value) : item.value;
          const content = await fs.readTextFile(fullPath);
          task += `${content}

`;
        } catch (err) {
          task += `(Error reading file ${item.value}: ${err})

`;
        }
      }
    }
  }

  if (testCases.length > 0) {
    task += `Test Cases:
`;
    testCases.forEach((tc, idx) => {
      task += `${idx + 1}. ${tc.title}
${tc.body}

`;
    });
  }

  const unfulfilledDeps = dependencies.filter((dep) => {
    const item = availableItems.find((i) => i.id === dep.targetId);
    return item && item.type === 'ticket' && item.status !== 'done' && item.status !== 'archived';
  });

  if (unfulfilledDeps.length > 0) {
    task += `Dependencies (must be fulfilled before implementation):
`;
    unfulfilledDeps.forEach((dep) => {
      const item = availableItems.find((i) => i.id === dep.targetId);
      if (item) {
        task += `- [ ] ${item.name} (${item.type})
`;
      }
    });
    task += `
`;
  }

  return task.trim();
}
