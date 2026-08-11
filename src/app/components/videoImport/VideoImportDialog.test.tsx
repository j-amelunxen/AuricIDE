import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useStore } from '@/lib/store';
import { VideoImportDialog } from './VideoImportDialog';

vi.mock('@/lib/tauri/videoImport', () => ({
  analyzeVideoMedia: vi.fn(),
  saveVideoProcessAnalysis: vi.fn(),
}));

describe('VideoImportDialog', () => {
  beforeEach(() => {
    useStore.setState({
      rootPath: '/tmp/project',
      videoImportDialogOpen: false,
    });
  });

  it('renders nothing while closed', () => {
    render(<VideoImportDialog />);
    expect(screen.queryByTestId('video-import-dialog')).toBeNull();
  });

  it('explains the lossless source contract when opened', () => {
    useStore.setState({ videoImportDialogOpen: true });
    render(<VideoImportDialog />);
    expect(screen.getByRole('dialog', { name: /import process from video/i })).toBeTruthy();
    expect(screen.getByText('No source information is discarded')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Analyze video' })).toBeDisabled();
  });
});
