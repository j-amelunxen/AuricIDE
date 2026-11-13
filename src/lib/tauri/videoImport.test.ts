import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./invoke', () => ({ invoke: vi.fn(async () => ({})) }));

import { invoke } from './invoke';
import { analyzeVideoMedia, getVideoImportPreflight, installLocalParakeet } from './videoImport';

describe('video import IPC', () => {
  beforeEach(() => vi.mocked(invoke).mockClear());

  it('forwards the project and source path to the native media pipeline', async () => {
    await analyzeVideoMedia('/project', '/videos/review.mp4');
    expect(invoke).toHaveBeenCalledWith('video_import_analyze_media', {
      projectPath: '/project',
      sourcePath: '/videos/review.mp4',
    });
  });

  it('checks the local runtime dependencies independently of a project', async () => {
    await getVideoImportPreflight();
    expect(invoke).toHaveBeenCalledWith('video_import_preflight');
  });

  it('installs the local runtime without arguments', async () => {
    await installLocalParakeet();
    expect(invoke).toHaveBeenCalledWith('video_import_install_local');
  });
});
