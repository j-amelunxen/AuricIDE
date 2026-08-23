import { c, cFill, l, p, r, type GlyphMap } from '../types';

/**
 * navigation family — authored in the Auric Line style (see core.ts for conventions).
 *
 * Everything in here is a control the user acts *through*, not an object they
 * look *at*: arrows, window chrome, toggles, media transport, editor toolbar
 * marks. So none of them carries an accent dot — a toolbar of accented icons
 * is a field of dots, and the accent stops meaning "look here". Boxes share
 * one 17×17 footprint and circles one r=8.25, so a plus, a check and a minus
 * read as the same family seen three ways.
 */
export const navigationGlyphs: GlyphMap = {
  // ── boxes & circles ──────────────────────────────────────────
  add_box: [r(3.5, 3.5, 17, 17, 3), l(12, 8, 12, 16), l(8, 12, 16, 12)],
  check_box: [r(3.5, 3.5, 17, 17, 3), p('M8 12.25l2.75 2.75L16.25 9')],
  add_circle: [c(12, 12, 8.25), l(12, 8, 12, 16), l(8, 12, 16, 12)],
  remove_circle: [c(12, 12, 8.25), l(8, 12, 16, 12)],
  // The fourth of the ring family, and the one that says "out of play":
  // the arms reach the same 4px from centre as the minus above, so a
  // discard sits at the same weight as a plus or a check, not louder.
  cancel: [c(12, 12, 8.25), l(9.2, 9.2, 14.8, 14.8), l(14.8, 9.2, 9.2, 14.8)],
  remove: [l(5, 12, 19, 12)],
  circle: [c(12, 12, 8.25)],
  // The bare ring the plus, minus and check are drawn inside — an unticked
  // choice, and the bullet an open condition gets in a list.
  radio_button_unchecked: [c(12, 12, 8.25)],

  // ── window & panel controls ──────────────────────────────────
  close_fullscreen: [p('M20 4l-6 6'), p('M18.5 10H14V5.5'), p('M4 20l6-6'), p('M5.5 14H10v4.5')],
  open_in_full: [p('M14 10l6-6'), p('M15.5 4H20v4.5'), p('M10 14l-6 6'), p('M8.5 20H4v-4.5')],
  open_in_new: [
    p('M20.5 13.5v5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h5'),
    l(11.5, 12.5, 20, 4),
    p('M14 4h6v6'),
  ],
  right_panel_close: [r(3.5, 4.5, 17, 15, 2), l(15, 4.5, 15, 19.5), p('M17.25 10l2 2-2 2')],
  tab_close_right: [
    p('M20.5 16.5H3.5V9.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v7'),
    l(14.5, 10, 18.5, 14),
    l(18.5, 10, 14.5, 14),
  ],
  keyboard_tab: [l(4, 12, 15, 12), p('M11.5 8.5l3.5 3.5-3.5 3.5'), l(19, 6.5, 19, 17.5)],
  height: [l(12, 4, 12, 20), p('M8.5 7.5L12 4l3.5 3.5'), p('M8.5 16.5L12 20l3.5-3.5')],

  // ── layout & lists ───────────────────────────────────────────
  view_agenda: [r(3.5, 4, 17, 7, 2), r(3.5, 13, 17, 7, 2)],
  view_column_2: [r(3.5, 4, 7.5, 16, 2), r(13, 4, 7.5, 16, 2)],
  filter_list: [l(4, 7, 20, 7), l(6.5, 12, 17.5, 12), l(9.5, 17, 14.5, 17)],
  format_list_bulleted: [
    cFill(5.25, 6.5, 1.25),
    cFill(5.25, 12, 1.25),
    cFill(5.25, 17.5, 1.25),
    l(9.5, 6.5, 19.5, 6.5),
    l(9.5, 12, 19.5, 12),
    l(9.5, 17.5, 19.5, 17.5),
  ],
  format_quote: [
    p('M5.5 17c3.4-1.6 4.5-4 4.5-7a3 3 0 1 0-5.1 2.1'),
    p('M13.5 17c3.4-1.6 4.5-4 4.5-7a3 3 0 1 0-5.1 2.1'),
  ],

  // ── transport & progress (pure line work) ────────────────────
  undo: [p('M6.5 11h8a4.5 4.5 0 0 1 0 9H9'), p('M10 7.5L6.5 11l3.5 3.5')],
  play_arrow: [p('M8 5.5l11 6.5-11 6.5Z')],
  // Same transport family as play, with the bar that says "and on to the
  // next one" — the combo card's advance control.
  skip_next: [p('M6 5.5l9.5 6.5L6 18.5Z'), l(18, 5.5, 18, 18.5)],
  stop: [r(5.5, 5.5, 13, 13, 2)],
  progress_activity: [p('M20.25 12a8.25 8.25 0 1 1-8.25-8.25')],
};
