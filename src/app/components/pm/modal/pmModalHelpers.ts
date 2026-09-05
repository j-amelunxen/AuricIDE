/** "1 ticket" / "3 tickets" — the count is the point, so it always leads. */
export function count(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? '' : 's'}`;
}

export function formatEpicDeleteMessage(ticketCount: number, testCaseCount: number): string {
  if (ticketCount === 0) {
    return 'This deletes the epic. It has no tickets.';
  }
  let message = `This deletes the epic and its ${count(ticketCount, 'ticket')}`;
  message += testCaseCount > 0 ? `, along with ${count(testCaseCount, 'test case')}.` : '.';
  return message;
}

export function formatTicketDeleteMessage(testCaseCount: number): string {
  if (testCaseCount === 0) {
    return 'This deletes the ticket. It has no test cases.';
  }
  return `This deletes the ticket and its ${count(testCaseCount, 'test case')}.`;
}
