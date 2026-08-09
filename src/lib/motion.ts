/**
 * The scroll behaviour that honours the user's motion preference.
 *
 * The global reduced-motion CSS cannot reach an explicit
 * `scrollIntoView({ behavior: 'smooth' })` — the JS option wins over the
 * stylesheet — so every programmatic smooth scroll asks here instead.
 * Checked at call time: the OS setting can change mid-session.
 */
export function scrollBehavior(): ScrollBehavior {
  if (typeof matchMedia !== 'function') return 'smooth';
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
