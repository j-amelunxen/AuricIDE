import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrchestrationModal } from './OrchestrationModal';

const storeState = {
  orchestrationOpen: true,
  setOrchestrationOpen: vi.fn(),
  goalsDraft: [],
  pmDraftTickets: [],
  agents: [],
  goalRunsDraft: [],
  conductorRunning: false,
  setSelectedGoalId: vi.fn(),
  setGoalsModalOpen: vi.fn(),
};

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

describe('OrchestrationModal', () => {
  it('exposes an accessible dialog', () => {
    render(<OrchestrationModal />);
    expect(screen.getByRole('dialog', { name: /orchestration/i })).toBeInTheDocument();
  });
});
