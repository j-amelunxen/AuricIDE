/**
 * The same rules Rust checks (`git check-ref-format`), so the field can say what is wrong
 * while typing. Rust still decides; a name that passes here can be refused there.
 */
const RULES: Array<[test: (name: string) => boolean, message: string]> = [
  [(n) => /[\u0000-\u001f\u007f]/.test(n), 'Names cannot contain control characters.'],
  [(n) => /\s/.test(n), 'Names cannot contain spaces.'],
  [(n) => /[~^:?*[\\]/.test(n), 'Names cannot contain ~ ^ : ? * [ or a backslash.'],
  [(n) => n.includes('..'), 'Names cannot contain “..”.'],
  [(n) => n.includes('@{'), 'Names cannot contain “@{”.'],
  [(n) => n === '@', 'That name is reserved.'],
  [(n) => n.startsWith('-'), 'Names cannot start with a dash.'],
  [(n) => n.startsWith('/') || n.endsWith('/'), 'Names cannot start or end with a slash.'],
  [(n) => n.includes('//'), 'Names cannot contain two slashes in a row.'],
  [(n) => n.endsWith('.'), 'Names cannot end with a dot.'],
  [(n) => n.endsWith('.lock'), 'Names cannot end with “.lock”.'],
  [
    (n) => n.split('/').some((part) => part.startsWith('.')),
    'A part of the name cannot start with a dot.',
  ],
];

/** The first problem with `name` as a sentence, or null when it is fine. */
export function validateRefName(name: string, taken: ReadonlySet<string>): string | null {
  if (!name.trim()) return 'Enter a name.';
  const broken = RULES.find(([test]) => test(name));
  if (broken) return broken[1];
  return taken.has(name) ? 'That name is already taken.' : null;
}
