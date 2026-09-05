import type { ProcessActor, ProcessStationKind } from '@/lib/videoImport/processExtraction';

export type DialogStage = 'select' | 'analyzing' | 'review' | 'saving';

export const ACCEPTED_VIDEO = /\.(mp4|mov|mkv|webm|m4v)$/i;

export const ACTORS: Array<{ value: ProcessActor; label: string }> = [
  { value: 'agent', label: 'Agent' },
  { value: 'human', label: 'Human' },
  { value: 'system', label: 'System' },
  { value: 'unknown', label: 'Unclear' },
];

export const STATION_KINDS: Array<{ value: ProcessStationKind; label: string }> = [
  { value: 'normal', label: 'Step' },
  { value: 'gate', label: 'Gate' },
  { value: 'human', label: 'Human task' },
];

export function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function shortPath(path: string): string {
  const pieces = path.split(/[\\/]/);
  return pieces.at(-1) ?? path;
}
