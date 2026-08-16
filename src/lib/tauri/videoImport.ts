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

/** One dependency of the local runtime, checked before anything is run. */
export interface PreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  /** What is on this machine, when it could be determined. */
  found: string | null;
  requirement: string;
  /** One sentence. Never tool output. */
  detail: string;
  /** A single command the user can copy, when one exists. */
  fix: string | null;
}

export interface Preflight {
  /** Everything is in place; a transcription can run right now. */
  ready: boolean;
  /** Every dependency holds and only the runtime itself is missing. */
  canInstall: boolean;
  checks: PreflightCheck[];
  runtimeDir: string;
  executable: string | null;
}

/** Emitted per line while Setup runs, so a long download stays visible. */
export const SETUP_PROGRESS_EVENT = 'video-import-setup-progress';

export async function analyzeVideoMedia(
  projectPath: string,
  sourcePath: string
): Promise<VideoMediaAnalysis> {
  return invoke<VideoMediaAnalysis>('video_import_analyze_media', { projectPath, sourcePath });
}

export async function getVideoImportPreflight(): Promise<Preflight> {
  return invoke<Preflight>('video_import_preflight');
}

export async function installLocalParakeet(): Promise<Preflight> {
  return invoke<Preflight>('video_import_install_local');
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
