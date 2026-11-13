import type { TranscriptionMode } from '@/lib/tauri/videoImport';
import { CREDENTIAL_NAMESPACES } from '@/lib/tauri/appCredentials';
import fixture from './videoImportSettings.fixtures.json';

/** The project-database namespace video import reads; Rust reads the same keys (`video_import`). */
export const VIDEO_IMPORT_SETTINGS_NS = CREDENTIAL_NAMESPACES.videoImport;
/** Commits the import made per source video, so a re-import can name what it replaces. */
export const VIDEO_IMPORT_COMMITS_NS = 'video_import_commit_ids';

export interface VideoImportSettings {
  transcriptionMode: TranscriptionMode;
  remoteEndpoint: string;
  remoteApiKey: string;
  remoteModel: string;
  localCommand: string;
  localArgs: string;
  visionEnabled: boolean;
}

export const VIDEO_IMPORT_SETTING_KEYS: Record<keyof VideoImportSettings, string> = {
  transcriptionMode: 'transcription_mode',
  remoteEndpoint: 'remote_endpoint',
  remoteApiKey: 'remote_api_key',
  remoteModel: 'remote_model',
  localCommand: 'local_command',
  localArgs: 'local_args',
  visionEnabled: 'vision_enabled',
};

const stored = fixture.defaults;

export const VIDEO_IMPORT_DEFAULTS: VideoImportSettings = {
  transcriptionMode: stored.transcription_mode as TranscriptionMode,
  remoteEndpoint: stored.remote_endpoint,
  remoteApiKey: stored.remote_api_key,
  remoteModel: stored.remote_model,
  localCommand: stored.local_command,
  localArgs: stored.local_args,
  visionEnabled: stored.vision_enabled !== 'false',
};

/** Vision is on unless the project switched it off. */
export const visionEnabledFrom = (stored: string | null): boolean => stored !== 'false';
