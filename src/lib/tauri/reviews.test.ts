import { describe, expect, it, vi, beforeEach } from 'vitest';
import { pmLatestTicketReview } from './reviews';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

describe('pmLatestTicketReview', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('passes projectPath, ticketId and sinceIso through to the pm_latest_ticket_review command', async () => {
    invokeMock.mockResolvedValue({
      ticketId: 't1',
      pass: true,
      reason: 'Meets all acceptance criteria',
      reviewer: 'review-agent',
      createdAt: '2026-01-01 00:00:00',
    });

    const review = await pmLatestTicketReview('/project', 't1', '2026-01-01 00:00:00');

    expect(invokeMock).toHaveBeenCalledWith('pm_latest_ticket_review', {
      projectPath: '/project',
      ticketId: 't1',
      sinceIso: '2026-01-01 00:00:00',
    });
    expect(review).toEqual({
      ticketId: 't1',
      pass: true,
      reason: 'Meets all acceptance criteria',
      reviewer: 'review-agent',
      createdAt: '2026-01-01 00:00:00',
    });
  });

  it('omits sinceIso when not given', async () => {
    invokeMock.mockResolvedValue(null);

    await pmLatestTicketReview('/project', 't1');

    expect(invokeMock).toHaveBeenCalledWith('pm_latest_ticket_review', {
      projectPath: '/project',
      ticketId: 't1',
      sinceIso: undefined,
    });
  });

  it('resolves to null when no review has been recorded yet', async () => {
    invokeMock.mockResolvedValue(null);

    const review = await pmLatestTicketReview('/project', 't1');

    expect(review).toBeNull();
  });
});
