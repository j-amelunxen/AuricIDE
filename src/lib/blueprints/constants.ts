import type { Blueprint } from '../tauri/blueprints';

export const COMPLEXITY_OPTIONS: {
  value: Blueprint['complexity'];
  label: string;
  className: string;
}[] = [
  {
    value: 'EASY',
    label: 'Easy',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  },
  {
    value: 'MEDIUM',
    label: 'Medium',
    className: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  },
  {
    value: 'HARD',
    label: 'Hard',
    className: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
  },
];

export const COMPLEXITY_MAP: Record<string, { label: string; className: string }> =
  Object.fromEntries(COMPLEXITY_OPTIONS.map((o) => [o.value, { label: o.label, className: o.className }]));

export const CATEGORY_OPTIONS: { value: Blueprint['category']; label: string }[] = [
  { value: 'architectures', label: 'Architectures' },
  { value: 'optimizations', label: 'Optimizations' },
  { value: 'ui-and-marketing', label: 'UI & Marketing' },
];

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
);
