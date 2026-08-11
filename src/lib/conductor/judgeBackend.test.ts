import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PmTicket, PmTestCase } from '@/lib/tauri/pm';
import type { PmGoal } from '@/lib/tauri/goals';

vi.mock('@/lib/tauri/llm', () => ({ llmCall: vi.fn() }));

import {
  createJudgeBackend,
  buildReviewAgentPrompt,
  buildTicketJudgePrompt,
  type AgentJudgeDeps,
  type JudgeInput,
} from './judgeBackend';
import { llmCall } from '@/lib/tauri/llm';

const TS = '2026-01-10 10:00:00';

const ticket = {
  id: 't1',
  epicId: 'e1',
  name: 'Date parsing',
  description: 'Parse all supported date formats',
  status: 'in_review',
  statusUpdatedAt: TS,
  sortOrder: 0,
  priority: 'normal',
  createdAt: TS,
  updatedAt: TS,
} as PmTicket;

const goal = { id: 'g1', name: 'Ship', successCriteria: 'dates work' } as PmGoal;

const testCases: PmTestCase[] = [
  {
    id: 'tc1',
    ticketId: 't1',
    title: 'handles ISO 8601',
    body: '',
    sortOrder: 0,
    createdAt: TS,
    updatedAt: TS,
  },
  {
    id: 'tc2',
    ticketId: 'other',
    title: 'unrelated',
    body: '',
    sortOrder: 0,
    createdAt: TS,
    updatedAt: TS,
  },
];

const input: JudgeInput = { ticket, goal, testCases, projectPath: '/p' };

describe('buildTicketJudgePrompt', () => {
  it('includes the ticket, goal criteria, and only the ticket-scoped acceptance cases', () => {
    const prompt = buildTicketJudgePrompt(input);
    expect(prompt).toContain('Date parsing');
    expect(prompt).toContain('dates work');
    expect(prompt).toContain('handles ISO 8601');
    expect(prompt).not.toContain('unrelated'); // scoped to this ticket's cases
  });
});

describe('createJudgeBackend', () => {
  beforeEach(() => vi.mocked(llmCall).mockReset());

  it('LLM form resolves a verdict inline on the judge model', async () => {
    vi.mocked(llmCall).mockResolvedValue({ content: '{"pass":true,"reason":"criteria met"}' });
    const backend = createJudgeBackend('llm');
    const res = await backend.start(input);
    expect(res).toEqual({ kind: 'verdict', verdict: { pass: true, reason: 'criteria met' } });
    expect(vi.mocked(llmCall).mock.calls[0][0]).toMatchObject({ role: 'judge' });
  });

  it('a broken judge reply throws (never silently passes)', async () => {
    vi.mocked(llmCall).mockResolvedValue({ content: 'not json' });
    await expect(createJudgeBackend('llm').start(input)).rejects.toThrow();
  });

  it('the review-agent form needs its dependencies', () => {
    expect(() => createJudgeBackend('agent')).toThrow(/needs spawn/);
  });

  it('the review-agent form delegates to a spawned reviewer and collects its verdict', async () => {
    const deps: AgentJudgeDeps = {
      spawnReviewAgent: vi.fn(async () => 'rev-1'),
      latestReview: vi.fn(async () => ({ pass: true, reason: 'approved' })),
    };
    const backend = createJudgeBackend('agent', deps);
    const start = await backend.start(input);
    expect(start).toEqual({ kind: 'delegated', reviewAgentId: 'rev-1' });
    expect(deps.spawnReviewAgent).toHaveBeenCalledWith(input);
    const verdict = await backend.collectVerdict!('rev-1', 't1');
    expect(verdict).toEqual({ pass: true, reason: 'approved' });
    expect(deps.latestReview).toHaveBeenCalledWith('t1');
  });
});

describe('buildReviewAgentPrompt', () => {
  it('instructs the reviewer to submit its verdict via the MCP tool for this ticket', () => {
    const prompt = buildReviewAgentPrompt(input);
    expect(prompt).toContain('submit_ticket_review');
    expect(prompt).toContain('t1');
    expect(prompt).toContain('Date parsing');
  });
});
