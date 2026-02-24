import { describe, it, expect } from 'vitest';
import { generateDependencyProposalPrompt } from './dependencyProposal';
import type { PmTicket, PmEpic } from '../tauri/pm';

describe('generateDependencyProposalPrompt', () => {
  it('generates a prompt with ticket and epic information', () => {
    const ticket: PmTicket = {
      id: 't1',
      epicId: 'e1',
      name: 'Ticket 1',
      description: 'Implement login',
      status: 'open',
      statusUpdatedAt: '',
      sortOrder: 0,
      priority: 'normal',
      createdAt: '',
      updatedAt: '',
    };

    const epic: PmEpic = {
      id: 'e1',
      name: 'Epic 1',
      description: 'User Authentication',
      sortOrder: 0,
      createdAt: '',
      updatedAt: '',
    };

    const otherTickets: PmTicket[] = [
      {
        id: 't2',
        epicId: 'e1',
        name: 'Ticket 2',
        description: 'Database schema for users',
        status: 'open',
        statusUpdatedAt: '',
        sortOrder: 1,
        priority: 'normal',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const prompt = generateDependencyProposalPrompt(ticket, epic, [ticket, ...otherTickets]);

    expect(prompt).toContain('Ticket 1');
    expect(prompt).toContain('Implement login');
    expect(prompt).toContain('Epic 1');
    expect(prompt).toContain('User Authentication');
    expect(prompt).toContain('Ticket 2');
    expect(prompt).toContain('Database schema for users');
    expect(prompt).toContain('JSON array');
  });
});
