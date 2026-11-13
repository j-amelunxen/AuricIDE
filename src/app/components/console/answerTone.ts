/** Button colours for a quick answer: a yes reads green, a no red, anything else neutral. */
export function answerToneClass(label: string): string {
  if (/^yes\b/i.test(label))
    return 'border-emerald-400/40 text-emerald-400 hover:bg-emerald-400/10';
  if (/^no\b/i.test(label)) return 'border-red-400/35 text-red-400 hover:bg-red-400/10';
  return 'border-white/10 text-foreground-muted hover:bg-white/5';
}
