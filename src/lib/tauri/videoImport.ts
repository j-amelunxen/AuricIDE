import { invoke } from './invoke';
import type { TranscriptSegment, VideoFrame } from '@/lib/videoImport/processExtraction';

export type TranscriptionMode = 'automatic' | 'local' | 'remote';

export interface VideoMediaAnalysis {
  importId: string;
  sourcePath: string;
  sourceName: string;
  durationMs: number;
  workspacePath: string;
  transcript: TranscriptSegment[];
  frames: VideoFrame[];
  transcriptionProvider: 'local' | 'remote';
}

export interface LocalParakeetStatus {
  available: boolean;
  executable: string | null;
  detail: string;
}

export async function analyzeVideoMedia(
  projectPath: string,
  sourcePath: string
): Promise<VideoMediaAnalysis> {
  return invoke<VideoMediaAnalysis>('video_import_analyze_media', { projectPath, sourcePath });
}

export async function getLocalParakeetStatus(): Promise<LocalParakeetStatus> {
  return invoke<LocalParakeetStatus>('video_import_local_status');
}

export async function installLocalParakeet(): Promise<LocalParakeetStatus> {
  return invoke<LocalParakeetStatus>('video_import_install_local');
}

export async function saveVideoProcessAnalysis(
  projectPath: string,
  importId: string,
  process: unknown
): Promise<string> {
  return invoke<string>('video_import_save_process', {
    projectPath,
    importId,
    processJson: JSON.stringify(process, null, 2),
  });
}

export async function clearVideoImportCache(importId: string): Promise<void> {
  return invoke<void>('video_import_clear', { importId });
}
