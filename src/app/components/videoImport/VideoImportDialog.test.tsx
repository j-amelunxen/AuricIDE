import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useStore } from '@/lib/store';
import { VideoImportDialog } from './VideoImportDialog';

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  save: vi.fn(),
  llm: vi.fn(),
  openDialog: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock('@/lib/tauri/videoImport', () => ({
  analyzeVideoMedia: mocks.analyze,
  saveVideoProcessAnalysis: mocks.save,
}));
vi.mock('@/lib/tauri/llm', () => ({ llmCall: mocks.llm }));
vi.mock('@/lib/tauri/db', () => ({ dbGet: vi.fn(async () => 'false') }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.openDialog }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: mocks.openPath }));

describe('VideoImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      rootPath: '/tmp/project',
      videoImportDialogOpen: false,
    });
  });

  it('supports inspecting sources and editing ordered steps with focus feedback', async () => {
    mocks.openDialog.mockResolvedValue('/tmp/process.mp4');
    mocks.analyze.mockResolvedValue({
      importId: 'import-1',
      sourcePath: '/tmp/process.mp4',
      sourceName: 'process.mp4',
      durationMs: 2_000,
      workspacePath: '/tmp/.auric/video-imports/import-1',
      transcriptionProvider: 'local',
      transcript: [{ startMs: 0, endMs: 2_000, text: 'Build then deploy' }],
      frames: [{ timestampMs: 1_000, path: '/tmp/frame.jpg' }],
    });
    mocks.llm.mockResolvedValue({
      content: JSON.stringify({
        title: 'Release',
        objective: 'Release',
        successCriteria: 'Released',
        summary: '',
        steps: [
          {
            title: 'Build',
            description: '',
            actor: 'agent',
            confidence: 1,
            sourceSegmentIds: [0],
            frameTimestampsMs: [1000],
          },
          {
            title: 'Deploy',
            description: '',
            actor: 'agent',
            confidence: 1,
            sourceSegmentIds: [0],
            frameTimestampsMs: [],
          },
        ],
        ambiguities: [],
        deferredIdeas: [],
      }),
    });
    useStore.setState({ videoImportDialogOpen: true });
    render(<VideoImportDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose video' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Analyze video' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Analyze video' }));
    await screen.findByRole('button', { name: /open screenshot at 1 second/i });
    fireEvent.click(screen.getByRole('button', { name: /open screenshot at 1 second/i }));
    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/tmp/frame.jpg'));

    fireEvent.click(screen.getByRole('button', { name: 'Move step 1 down' }));
    await waitFor(() => expect(screen.getByLabelText('Step 2 title')).toHaveValue('Build'));
    expect(screen.getByRole('status')).toHaveTextContent('Moved Build to position 2');
    expect(screen.getByLabelText('Step 2 title')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    await waitFor(() => expect(screen.getByLabelText('Step 3 title')).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Added step 3');
  });

  it('renders nothing while closed', () => {
    render(<VideoImportDialog />);
    expect(screen.queryByTestId('video-import-dialog')).toBeNull();
  });

  it('explains the lossless source contract when opened', () => {
    useStore.setState({ videoImportDialogOpen: true });
    render(<VideoImportDialog />);
    expect(screen.getByRole('dialog', { name: /import process from video/i })).toBeTruthy();
    expect(screen.getByText('Source kept')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Analyze video' })).toBeDisabled();
  });

  it('cancels in-flight analysis and ignores late results', async () => {
    let resolveAnalyze: (value: unknown) => void = () => undefined;
    mocks.openDialog.mockResolvedValue('/tmp/process.mp4');
    mocks.analyze.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAnalyze = resolve;
        })
    );
    mocks.llm.mockResolvedValue({
      content: JSON.stringify({
        title: 'Release',
        objective: 'Release',
        successCriteria: 'Released',
        summary: '',
        steps: [
          {
            title: 'Build',
            description: '',
            actor: 'agent',
            confidence: 1,
            sourceSegmentIds: [0],
            frameTimestampsMs: [1000],
          },
        ],
        ambiguities: [],
        deferredIdeas: [],
      }),
    });

    useStore.setState({ videoImportDialogOpen: true });
    render(<VideoImportDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose video' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Analyze video' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Analyze video' }));

    const cancel = await screen.findByTestId('video-import-cancel-analysis');
    expect(cancel).toHaveTextContent('Cancel analysis');

    fireEvent.click(screen.getByTestId('video-import-dialog').parentElement!);
    expect(useStore.getState().videoImportDialogOpen).toBe(true);
    expect(screen.getByTestId('video-import-cancel-analysis')).toBeVisible();

    fireEvent.click(cancel);

    expect(screen.getByRole('button', { name: 'Analyze video' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose another video' })).toBeVisible();
    expect(screen.getByText('process.mp4')).toBeTruthy();
    expect(screen.queryByTestId('video-import-cancel-analysis')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    resolveAnalyze({
      importId: 'import-1',
      sourcePath: '/tmp/process.mp4',
      sourceName: 'process.mp4',
      durationMs: 2_000,
      workspacePath: '/tmp/.auric/video-imports/import-1',
      transcriptionProvider: 'local',
      transcript: [{ startMs: 0, endMs: 2_000, text: 'Build then deploy' }],
      frames: [{ timestampMs: 1_000, path: '/tmp/frame.jpg' }],
    });

    await waitFor(() => expect(mocks.analyze).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /open screenshot/i })).toBeNull();
    expect(screen.queryByText('Process stations')).toBeNull();
    expect(screen.getByRole('button', { name: 'Analyze video' })).toBeVisible();
  });

  it('asks an elevate confirm before Create and run starts the conductor', async () => {
    const startConductor = vi.fn();
    mocks.openDialog.mockResolvedValue('/tmp/process.mp4');
    mocks.analyze.mockResolvedValue({
      importId: 'import-1',
      sourcePath: '/tmp/process.mp4',
      sourceName: 'process.mp4',
      durationMs: 2_000,
      workspacePath: '/tmp/.auric/video-imports/import-1',
      transcriptionProvider: 'local',
      transcript: [{ startMs: 0, endMs: 2_000, text: 'Build then deploy' }],
      frames: [{ timestampMs: 1_000, path: '/tmp/frame.jpg' }],
    });
    mocks.llm.mockResolvedValue({
      content: JSON.stringify({
        title: 'Release',
        objective: 'Release',
        successCriteria: 'Released',
        summary: '',
        steps: [
          {
            title: 'Build',
            description: '',
            actor: 'agent',
            confidence: 1,
            sourceSegmentIds: [0],
            frameTimestampsMs: [1000],
          },
        ],
        ambiguities: [],
        deferredIdeas: [],
      }),
    });
    useStore.setState({
      videoImportDialogOpen: true,
      startConductor,
      savePmData: vi.fn(async () => undefined),
      saveGoals: vi.fn(async () => undefined),
    });
    render(<VideoImportDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose video' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Analyze video' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Analyze video' }));
    await screen.findByRole('button', { name: /create and review/i });

    fireEvent.click(screen.getByLabelText(/start conductor after creation/i));
    fireEvent.click(screen.getByRole('button', { name: /create and run/i }));

    const question = await screen.findByRole('dialog', { name: /start the conductor/i });
    expect(within(question).getByRole('button', { name: 'Create and run' }).className).toMatch(
      /amber/
    );
    expect(startConductor).not.toHaveBeenCalled();

    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: /start the conductor/i })).not.toBeInTheDocument();
    expect(startConductor).not.toHaveBeenCalled();
    expect(useStore.getState().videoImportDialogOpen).toBe(true);
  });

  it('does not surface a cancelled analyze rejection as an error', async () => {
    let rejectAnalyze: (reason: unknown) => void = () => undefined;
    mocks.openDialog.mockResolvedValue('/tmp/process.mp4');
    mocks.analyze.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectAnalyze = reject;
        })
    );

    useStore.setState({ videoImportDialogOpen: true });
    render(<VideoImportDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose video' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Analyze video' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Analyze video' }));
    await screen.findByTestId('video-import-cancel-analysis');
    fireEvent.click(screen.getByTestId('video-import-cancel-analysis'));

    rejectAnalyze(new Error('aborted'));

    await waitFor(() => expect(mocks.analyze).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Analyze video' })).toBeVisible();
  });
});
