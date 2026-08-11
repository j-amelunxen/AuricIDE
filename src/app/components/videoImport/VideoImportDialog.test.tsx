import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
