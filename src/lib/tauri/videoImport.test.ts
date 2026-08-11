import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./invoke', () => ({ invoke: vi.fn(async () => ({})) }));

import { invoke } from './invoke';
import { analyzeVideoMedia, getLocalParakeetStatus } from './videoImport';

describe('video import IPC', () => {
  beforeEach(() => vi.mocked(invoke).mockClear());

  it('forwards the project and source path to the native media pipeline', async () => {
    await analyzeVideoMedia('/project', '/videos/review.mp4');
    expect(invoke).toHaveBeenCalledWith('video_import_analyze_media', {
      projectPath: '/project',
      sourcePath: '/videos/review.mp4',
    });
  });

  it('queries the managed local Parakeet runtime independently of a project', async () => {
    await getLocalParakeetStatus();
    expect(invoke).toHaveBeenCalledWith('video_import_local_status');
  });
});
