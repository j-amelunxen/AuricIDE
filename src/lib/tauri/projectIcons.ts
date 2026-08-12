import { invoke } from './invoke';
import { readFileBase64 } from './fs';

export interface ProjectIconCandidate {
  path: string;
  relativePath: string;
  fileName: string;
  sizeBytes: number;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ico: 'image/x-icon',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/**
 * The files in a project that plausibly are its icon, best first — a favicon
 * in `public/` outranks a logo buried in `docs/`. Dependency directories are
 * never walked.
 *
 * Never rejects: browser-mode development has no filesystem, and the caller
 * shows a list either way.
 */
export async function findProjectIconCandidates(
  projectPath: string
): Promise<ProjectIconCandidate[]> {
  if (!projectPath) return [];
  try {
    const result = await invoke<ProjectIconCandidate[]>('project_icon_candidates', {
      projectPath,
    });
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.debug('project_icon_candidates unavailable', error);
    return [];
  }
}

/**
 * Reads an image file into a data URI.
 *
 * Tiles store the PATH, not the bytes: the starred-projects file is rewritten
 * in full on every star toggle, and inlining a favicon per project would make
 * that write grow without bound. The cost is this read — cheap, cached by
 * `imageIconCache`, and it degrades to the generated initials when the file
 * has moved or gone.
 */
export async function readImageAsDataUri(path: string): Promise<string | null> {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) return null;
  try {
    const base64 = await readFileBase64(path);
    if (!base64) return null;
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}
