const GERMAN_REPLACEMENTS: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'ae',
  Ö: 'oe',
  Ü: 'ue',
  ß: 'ss',
};

/** Turns a scene name into a safe spec file slug (never empty). */
export function slugifySceneName(name: string): string {
  const slug = name
    .replace(/[äöüÄÖÜß]/g, (c) => GERMAN_REPLACEMENTS[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'diagram';
}
