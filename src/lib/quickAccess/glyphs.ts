/**
 * The glyphs offered in the tile icon picker.
 *
 * Curated rather than the full registry (~154 names): a picker is only useful
 * while it stays scannable, and most of the registry is IDE chrome — chevrons,
 * checkboxes, panel controls — that says nothing about what a project IS.
 * These read as project kinds.
 *
 * Guarded by glyphs.test.ts: every name here must resolve through `getGlyph`.
 * That test is not optional. A user's chosen name reaches AuricIcon through
 * stored data, and `src/lib/icons/coverage.test.ts` only scans string literals
 * in source — it cannot catch a name that goes stale here.
 */
export const QUICK_ACCESS_GLYPHS = [
  // Build & ship
  'rocket_launch',
  'bolt',
  'auto_awesome',
  'auto_fix_high',
  'star',
  'flag',
  // Code
  'terminal',
  'code',
  'data_object',
  'function',
  'html',
  'css',
  'javascript',
  // Writing
  'description',
  'article',
  'edit_note',
  'draw',
  'menu_book',
  'library_books',
  // Media & design
  'image',
  'movie',
  'video_file',
  'palette',
  'title',
  // Infrastructure
  'database',
  'cloud',
  'shield',
  'lock',
  'key',
  'bug_report',
  // Structure
  'schema',
  'account_tree',
  'architecture',
  'hub',
  'route',
  'alt_route',
  // Insight
  'analytics',
  'bar_chart',
  'trending_up',
  'memory',
  'psychology',
  'lightbulb',
  // Things
  'smart_toy',
  'extension',
  'inventory_2',
  'folder',
  'sell',
  'push_pin',
  // Time
  'calendar_today',
  'timer',
  'history',
  'local_fire_department',
] as const;
