/**
 * The path without trailing slashes, so `/a/b/` and `/a/b` compare equal; the root `/` stays.
 * Every path-equality key on the frontend goes through this one rule.
 */
export function withoutTrailingSlash(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' && path.startsWith('/') ? '/' : trimmed;
}
