import { describe, it, expect, vi } from 'vitest';
import { generateTicketPrompt } from './prompt';
import type { PmTicket, PmTestCase, PmDependency } from '../tauri/pm';

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(async (path: string) => `Content of ${path}`),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn(async (...args: string[]) => args.join('/')),
}));

describe('generateTicketPrompt', () => {
  const mockTicket: PmTicket = {
    id: 't1',
    epicId: 'e1',
    name: 'Test Ticket',
    description: 'A test ticket description',
    status: 'open',
    statusUpdatedAt: '',
    priority: 'normal',
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    context: [
      { id: 'c1', type: 'snippet', value: 'some code snippet' },
      { id: 'c2', type: 'file', value: 'src/main.ts' },
    ],
  };

  const mockTestCases: PmTestCase[] = [
    {
      id: 'tc1',
      ticketId: 't1',
      title: 'Test 1',
      body: 'Body 1',
      sortOrder: 0,
      createdAt: '',
      updatedAt: '',
    },
  ];

  const mockDeps: PmDependency[] = [
    { id: 'd1', sourceType: 'ticket', sourceId: 't1', targetType: 'ticket', targetId: 't2' },
  ];

  const mockAvailableItems = [
    { id: 't2', type: 'ticket' as const, name: 'Dependency Ticket', status: 'open' },
  ];

  it('generates a complete prompt', async () => {
    const prompt = await generateTicketPrompt(
      mockTicket,
      mockTestCases,
      mockDeps,
      mockAvailableItems,
      '/root'
    );

    expect(prompt).toContain('Implementation of ticket: Test Ticket');
    expect(prompt).toContain('A test ticket description');
    expect(prompt).toContain('Priority: NORMAL');
    expect(prompt).toContain('some code snippet');
    expect(prompt).toContain('--- File: src/main.ts ---');
    expect(prompt).toContain('Content of /root/src/main.ts');
    expect(prompt).toContain('Test Cases:');
    expect(prompt).toContain('1. Test 1');
    expect(prompt).toContain('Dependencies (must be fulfilled before implementation):');
    expect(prompt).toContain('- [ ] Dependency Ticket (ticket)');
  });

  it('includes model power if set', async () => {
    const ticketWithPower: PmTicket = {
      ...mockTicket,
      modelPower: 'high',
    };
    const prompt = await generateTicketPrompt(ticketWithPower, [], [], []);
    expect(prompt).toContain('Model Power Recommended: HIGH');
    expect(prompt).toContain('complexity and required reasoning capabilities');
  });

  it('omits dependencies if they are done', async () => {
    const doneAvailableItems = [
      { id: 't2', type: 'ticket' as const, name: 'Dependency Ticket', status: 'done' },
    ];
    const prompt = await generateTicketPrompt(
      mockTicket,
      [],
      mockDeps,
      doneAvailableItems,
      '/root'
    );

    expect(prompt).not.toContain('Dependencies');
  });
});
