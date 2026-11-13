import { withoutTrailingSlash } from './withoutTrailingSlash';

/** The last segment of a `/`-separated path; a trailing slash is ignored. */
export function baseName(path: string): string {
  const trimmed = withoutTrailingSlash(path);
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}
