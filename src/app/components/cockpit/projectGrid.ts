/** How many project tiles a row holds before the next one starts underneath. */
export const PROJECT_TILE_COLUMNS = 8;

/**
 * The tile row both switcher tabs are laid out on: a wrapping row exactly wide
 * enough for eight tiles (8 × 5rem plus the seven 0.5rem gaps), so the ninth
 * project starts a second row underneath.
 *
 * Wrapping rather than a fixed eight-column grid, because every row centres
 * itself that way — a short last row sitting hard against the left edge under a
 * centred column reads as a layout bug, not as a stable position. `max-w-full`
 * lets the row shrink rather than push a scrollbar onto the cockpit when the
 * editor area is narrow.
 */
export const PROJECT_TILE_GRID =
  'flex w-[43.5rem] max-w-full flex-wrap justify-center gap-x-2 gap-y-4';
