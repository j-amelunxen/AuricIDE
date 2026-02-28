import type { PmTicket } from '../tauri/pm';

export function generateTestCaseDerivationPrompt(ticket: PmTicket): string {
  return `You are a QA Engineer. Based on the following ticket, derive meaningful test cases similar to TestRail.
Each test case should have a TITLE and a BODY (including steps and expected results).

Ticket Name: ${ticket.name}
Ticket Description: ${ticket.description}

Format your response exactly as follows:
TITLE: [Test Case Title]
BODY: [Steps and Expected Results]

TITLE: [Next Test Case Title]
BODY: [Next Steps and Expected Results]
...

Focus on edge cases, happy paths, and error handling.`;
}

export function parseTestCaseResponse(response: string): { title: string; body: string }[] {
  const testCases: { title: string; body: string }[] = [];
  const lines = response.split('\n');
  let currentTitle = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase().startsWith('TITLE:')) {
      if (currentTitle) {
        testCases.push({ title: currentTitle, body: currentBody.join('\n').trim() });
      }
      currentTitle = trimmed.substring(6).trim();
      currentBody = [];
    } else if (trimmed.toUpperCase().startsWith('BODY:')) {
      const rest = trimmed.substring(5).trim();
      if (rest) currentBody.push(rest);
    } else if (currentTitle) {
      currentBody.push(line);
    }
  }

  if (currentTitle) {
    testCases.push({ title: currentTitle, body: currentBody.join('\n').trim() });
  }

  return testCases;
}
