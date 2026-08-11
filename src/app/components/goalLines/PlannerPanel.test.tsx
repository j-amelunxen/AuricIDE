import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useStore } from '@/lib/store';
import type { PmGoal } from '@/lib/tauri/goals';
import { PlannerPanel } from './PlannerPanel';

const mockLlmCall = vi.fn<(...a: unknown[]) => Promise<{ content: string }>>();
vi.mock('@/lib/tauri/llm', () => ({
  llmCall: (request: unknown) => mockLlmCall(request),
}));

const mockDbGet = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => null);
const mockDbSet = vi.fn(
  async (_projectPath: string, _namespace: string, _key: string, _value: string) => {}
);
const mockDbDelete = vi.fn(async (_projectPath: string, _namespace: string, _key: string) => true);
vi.mock('@/lib/tauri/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  dbGet: (projectPath: string, namespace: string, key: string) =>
    mockDbGet(projectPath, namespace, key),
  dbSet: (projectPath: string, namespace: string, key: string, value: string) =>
    mockDbSet(projectPath, namespace, key, value),
  dbDelete: (projectPath: string, namespace: string, key: string) =>
    mockDbDelete(projectPath, namespace, key),
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
    selectedGoalId: null,
    goalLinesOpen: true,
    goalsModalOpen: false,
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
    expect(screen.getByTestId('planner-refine-label').textContent).toContain('Reprompt');
  });

  it('manually edits, adds, reorders and removes stations and persists each change', async () => {
    const goal = makeGoal();
    seed(goal);
    mockLlmCall.mockResolvedValueOnce({ content: GRAPH_RESPONSE });
    render(<PlannerPanel />);
    await proposeDraft(goal);

    fireEvent.change(screen.getByTestId('planner-station-name-0'), {
      target: { value: 'Inventory every guide' },
    });
    fireEvent.change(screen.getByTestId('planner-station-predicate-0'), {
      target: { value: 'file_exists' },
    });
    fireEvent.change(screen.getByTestId('planner-station-predicate-value-0'), {
      target: { value: 'docs/**/*.md' },
    });
    fireEvent.click(screen.getByTestId('planner-station-fog-0'));
    fireEvent.click(screen.getByTestId('planner-station-down-0'));
    fireEvent.click(screen.getByTestId('planner-add-station'));
    fireEvent.click(screen.getByTestId('planner-station-remove-2'));

    await waitFor(() => expect(mockDbSet.mock.calls.length).toBeGreaterThanOrEqual(7));
    const saved = JSON.parse(mockDbSet.mock.calls.at(-1)![3] as string);
    expect(saved.graph.stations).toHaveLength(2);
    expect(saved.graph.stations[1]).toMatchObject({
      name: 'Inventory every guide',
      evidenceKind: 'proof',
      predicate: { type: 'file_exists', glob: 'docs/**/*.md' },
      fog: true,
    });
  });

  it('keeps human station fields coherent and blocks start for incomplete values', async () => {
    const goal = makeGoal();
    seed(goal);
    mockLlmCall.mockResolvedValueOnce({ content: GRAPH_RESPONSE });
    render(<PlannerPanel />);
    await proposeDraft(goal);

    fireEvent.change(screen.getByTestId('planner-station-kind-0'), {
      target: { value: 'human' },
    });
    expect((screen.getByTestId('planner-station-evidence-0') as HTMLSelectElement).value).toBe(
      'human'
    );
    expect((screen.getByTestId('planner-station-predicate-0') as HTMLSelectElement).value).toBe(
      'human'
    );
    fireEvent.change(screen.getByTestId('planner-station-kind-0'), {
      target: { value: 'gate' },
    });
    expect((screen.getByTestId('planner-station-evidence-0') as HTMLSelectElement).value).toBe(
      'claim'
    );
    expect((screen.getByTestId('planner-station-predicate-0') as HTMLSelectElement).value).toBe(
      'undefined'
    );

    fireEvent.change(screen.getByTestId('planner-station-evidence-0'), {
      target: { value: 'judged' },
    });
    expect((screen.getByTestId('planner-station-predicate-0') as HTMLSelectElement).value).toBe(
      'judged'
    );

    fireEvent.change(screen.getByTestId('planner-station-name-0'), { target: { value: '   ' } });
    expect(screen.getByTestId('planner-start')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('planner-validation').textContent).toContain('name');
    expect(screen.getByTestId('planner-station-name-0').getAttribute('aria-invalid')).toBe('true');
  });

  it('reprompts from the manually edited current graph and remains repeatable', async () => {
    const goal = makeGoal();
    seed(goal);
    mockLlmCall.mockResolvedValueOnce({ content: GRAPH_RESPONSE });
    render(<PlannerPanel />);
    await proposeDraft(goal);
    fireEvent.change(screen.getByTestId('planner-station-name-0'), {
      target: { value: 'Manual current step' },
    });
    mockLlmCall.mockResolvedValueOnce({ content: JSON.stringify({ ops: [] }) });
    fireEvent.change(screen.getByTestId('planner-refine'), { target: { value: 'First reprompt' } });
    fireEvent.click(screen.getByTestId('planner-apply'));
    await waitFor(() => expect(screen.getByText(/v2: First reprompt/)).toBeTruthy());
    expect(JSON.stringify(mockLlmCall.mock.calls[1])).toContain('Manual current step');

    mockLlmCall.mockResolvedValueOnce({ content: JSON.stringify({ ops: [] }) });
    fireEvent.change(screen.getByTestId('planner-refine'), {
      target: { value: 'Second reprompt' },
    });
    fireEvent.click(screen.getByTestId('planner-apply'));
    await waitFor(() => expect(screen.getByText(/v3: Second reprompt/)).toBeTruthy());
  });

  it('"Save line" commits checkpoints and explains that tickets are created next', async () => {
    const goal = makeGoal({ status: 'draft' });
    seed(goal);
    mockLlmCall.mockResolvedValueOnce({ content: GRAPH_RESPONSE });
    render(<PlannerPanel />);
    await proposeDraft(goal);

    expect(screen.getByTestId('planner-start')).toHaveTextContent('Save line');
    expect(screen.getByTestId('planner-preview')).toHaveTextContent(
      /saves checkpoints.*tickets.*next/i
    );

    fireEvent.click(screen.getByTestId('planner-start'));

    const state = useStore.getState();
    expect(state.goalStationsDraft).toHaveLength(2);
    expect(state.goalStationsDraft[1].kind).toBe('human');
    expect(state.goalsDraft[0].status).toBe('active');
    expect(state.saveGoals).toHaveBeenCalled();
    await waitFor(() => expect(useStore.getState().selectedGoalId).toBe(goal.id));
    expect(useStore.getState().goalLinesOpen).toBe(false);
    expect(useStore.getState().goalsModalOpen).toBe(true);
    await waitFor(() =>
      expect(mockDbDelete).toHaveBeenCalledWith('/tmp/demo-project', 'goal_line_planner', goal.id)
    );
  });

  it('ignores a second Save line click while persistence is in flight', async () => {
    const goal = makeGoal({ status: 'draft' });
    let resolveSave!: () => void;
    const saveGoals = vi.fn(() => new Promise<void>((resolve) => (resolveSave = resolve)));
    seed(goal);
    useStore.setState({ saveGoals });
    mockLlmCall.mockResolvedValueOnce({ content: GRAPH_RESPONSE });
    render(<PlannerPanel />);
    await proposeDraft(goal);

    fireEvent.click(screen.getByTestId('planner-start'));
    fireEvent.click(screen.getByTestId('planner-start'));

    expect(saveGoals).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('planner-start')).toBeDisabled();
    expect(screen.getByTestId('planner-start')).toHaveTextContent('Saving…');
    resolveSave();
    await waitFor(() => expect(useStore.getState().goalsModalOpen).toBe(true));
  });

  it('rolls back added checkpoints and goal status when Save line fails', async () => {
    const goal = makeGoal({ status: 'draft' });
    seed(goal);
    useStore.setState({ saveGoals: vi.fn(async () => Promise.reject(new Error('disk full'))) });
    mockLlmCall.mockResolvedValueOnce({ content: GRAPH_RESPONSE });
    render(<PlannerPanel />);
    await proposeDraft(goal);

    fireEvent.click(screen.getByTestId('planner-start'));

    await waitFor(() =>
      expect(screen.getByTestId('planner-error')).toHaveTextContent(/disk full/i)
    );
    expect(useStore.getState().goalStationsDraft).toHaveLength(0);
    expect(useStore.getState().goalsDraft[0].status).toBe('draft');
    expect(screen.getByTestId('planner-preview')).toBeInTheDocument();
    expect(useStore.getState().goalsModalOpen).toBe(false);
    expect(mockDbDelete).not.toHaveBeenCalled();
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
