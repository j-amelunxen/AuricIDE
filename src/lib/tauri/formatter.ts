import { invoke } from './invoke';

/** What `format_document` answers. It never writes the file; the caller does. */
export type FormatOutcome =
  | { status: 'formatted'; content: string; formatter: string }
  | { status: 'unchanged'; formatter: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; formatter: string; message: string };

export async function formatDocument(
  path: string,
  content: string,
  language: string
): Promise<FormatOutcome> {
  return await invoke<FormatOutcome>('format_document', { path, content, language });
}
