import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useStore } from '@/lib/store';
import type { PmGoal } from '@/lib/tauri/goals';
import { PlannerPanel } from './PlannerPanel';

const mockLlmCall = vi.fn<(...a: unknown[]) => Promise<{ content: string }>>();
vi.mock('@/lib/tauri/llm', () => ({
  llmCall: (...a: unknown[]) => mockLlmCall(...a),
}));

const mockDbGet = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => null);
const mockDbSet = vi.fn(async () => {});
const mockDbDelete = vi.fn(async () => true);
vi.mock('@/lib/tauri/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  dbGet: (...a: unknown[]) => mockDbGet(...a),
  dbSet: (...a: unknown[]) => mockDbSet(...a),
  dbDelete: (...a: unknown[]) => mockDbDelete(...a),
}));

const TS = '2026-01-10 10:00:00';

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: crypto.randomUUID(),
    parentId: null,
    name: 'Docs are current',
    description: '',
    successCriteria: 'A stranger finds their way in',
    status: 'draft',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

const GRAPH_RESPONSE = JSON.stringify({
  stations: [
    {
      name: 'Take inventory',
      kind: 'normal',
      evidenceKind: 'claim',
      predicate: { type: 'undefined' },
    },
    { name: 'Call the client', kind: 'human', evidenceKind: 'human', predicate: { type: 'human' } },
  ],
});

function seed(goal: PmGoal): void {
  useStore.setState({
    rootPath: '/tmp/demo-project',
    goalsDraft: [goal],
    goalStationsDraft: [],
    goalsDirty: false,
    llmConfigured: true,
    saveGoals: vi.fn(async () => {}),
  });
}

async function proposeDraft(goal: PmGoal): Promise<void> {
  fireEvent.click(screen.getByTestId('planner-toggle'));
  fireEvent.change(screen.getByTestId('planner-goal-select'), { target: { value: goal.id } });
  fireEvent.change(screen.getByTestId('planner-dump'), {
    target: { value: 'Sort the docs, then call the client about it.' },
  });
  fireEvent.click(screen.getByTestId('planner-propose'));
  await waitFor(() => expect(screen.getByTestId('planner-preview')).toBeTruthy());
}

describe('PlannerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbGet.mockResolvedValue(null);
  });

  it('proposes a draft from a dump and previews it without touching the board', async () => {
    const goal = makeGoal();
    seed(goal);
    mockLlmCall.mockResolvedValueOnce({ content: GRAPH_RESPONSE });
    render(<PlannerPanel />);
    await proposeDraft(goal);

    // Draft persisted to its own namespace, board untouched.
    expect(mockDbSet).toHaveBeenCalled();
    expect(useStore.getState().goalStationsDraft).toHaveLength(0);
  });

  it('shows the parse error verbatim when the model returns junk', async () => {
    const goal = makeGoal();
    seed(goal);
    mockLlmCall.mockResolvedValueOnce({ content: 'I would rather chat about the weather.' });
    render(<PlannerPanel />);
    fireEvent.click(screen.getByTestId('planner-toggle'));
    fireEvent.change(screen.getByTestId('planner-goal-select'), { target: { value: goal.id } });
    fireEvent.change(screen.getByTestId('planner-dump'), { target: { value: 'a dump' } });
    fireEvent.click(screen.getByTestId('planner-propose'));

    await waitFor(() =>
      expect(screen.getByTestId('planner-error').textContent).toContain('No JSON')
    );
    expect(useStore.getState().goalStationsDraft).toHaveLength(0);
  });

  it('applies a refinement diff and logs the revision', async () => {
    const goal = makeGoal();
    seed(goal);
    mockLlmCall.mockResolvedValueOnce({ content: GRAPH_RESPONSE });
    render(<PlannerPanel />);
    await proposeDraft(goal);

    mockLlmCall.mockResolvedValueOnce({
      content: JSON.stringify({ ops: [{ op: 'rename', index: 0, name: 'Inventory' }] }),
    });
    fireEvent.change(screen.getByTestId('planner-refine'), {
      target: { value: 'shorter name for the first step' },
    });
    fireEvent.keyDown(screen.getByTestId('planner-refine'), { key: 'Enter' });

    await waitFor(() => expect(screen.getByText(/v2: shorter name/)).toBeTruthy());
  });

  it('"Start this line" commits stations, activates the goal, and clears the draft', async () => {
    const goal = makeGoal({ status: 'draft' });
    seed(goal);
    mockLlmCall.mockResolvedValueOnce({ content: GRAPH_RESPONSE });
    render(<PlannerPanel />);
    await proposeDraft(goal);

    fireEvent.click(screen.getByTestId('planner-start'));

    const state = useStore.getState();
    expect(state.goalStationsDraft).toHaveLength(2);
    expect(state.goalStationsDraft[1].kind).toBe('human');
    expect(state.goalsDraft[0].status).toBe('active');
    expect(state.saveGoals).toHaveBeenCalled();
    expect(mockDbDelete).toHaveBeenCalledWith('/tmp/demo-project', 'goal_line_planner', goal.id);
  });

  it('resumes a persisted draft when the goal is selected', async () => {
    const goal = makeGoal();
    seed(goal);
    mockDbGet.mockResolvedValueOnce(
      JSON.stringify({
        graph: {
          stations: [
            {
              name: 'Resumed step',
              kind: 'normal',
              evidenceKind: 'claim',
              predicate: { type: 'undefined' },
            },
          ],
        },
        revisions: [],
      })
    );
    render(<PlannerPanel />);
    fireEvent.click(screen.getByTestId('planner-toggle'));
    fireEvent.change(screen.getByTestId('planner-goal-select'), { target: { value: goal.id } });

    await waitFor(() => expect(screen.getByTestId('planner-preview')).toBeTruthy());
    expect(mockLlmCall).not.toHaveBeenCalled();
  });
});
