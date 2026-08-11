import { dot, l, p, r, type GlyphMap } from '../types';

/**
 * Shared page silhouette. The file-shaped glyphs here are the same sheet of
 * paper as core's `description`/`draft` — only the mark inside changes, so a
 * row of them reads as one family instead of five different papers.
 */
const SHEET =
  'M6.5 3.5h6.6a1 1 0 0 1 .7.3l4.4 4.4a1 1 0 0 1 .3.7v11.6a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 20.5v-15a1.5 1.5 0 0 1 1.5-1.5Z';
const SHEET_FOLD = 'M13.5 3.8v3.9a1 1 0 0 0 1 1h3.9';

/** Folder silhouette, kept identical to core's `folder` for the same reason. */
const FOLDER =
  'M3.5 17.5v-11a2 2 0 0 1 2-2h3.2a1 1 0 0 1 .8.4l1.5 1.9a1 1 0 0 0 .8.4h7.7a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2Z';

/** Lid + body of the storage-box pair (`archive`, `inventory_2`). */
const BOX_BODY = 'M5 8.5v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10';

/** files family — authored in the Auric Line style (see core.ts for conventions). */
export const filesGlyphs: GlyphMap = {
  // ── documents ────────────────────────────────────────────────
  article: [
    r(4, 3.5, 16, 17, 2.5),
    l(7.5, 8.5, 16.5, 8.5),
    l(7.5, 12, 16.5, 12),
    l(7.5, 15.5, 13.5, 15.5),
    dot(15.75, 15.5, 1.5),
  ],
  receipt_long: [
    p('M5.5 3.5h13v17l-2.2-1.4-2.2 1.4-2.2-1.4-2.2 1.4-2.2-1.4L5.5 20.5Z'),
    l(8.5, 8, 15.5, 8),
    l(8.5, 11.5, 12.5, 11.5),
    dot(15, 11.5, 1.5),
  ],
  difference: [r(3.5, 3.5, 12, 12, 2), r(8.5, 8.5, 12, 12, 2), dot(12, 12, 1.75)],
  menu_book: [
    p(
      'M12 7.5a5.5 5.5 0 0 0-4.5-2.3H4.2a1 1 0 0 0-1 1v10.6a1 1 0 0 0 1 1h3.3A5.5 5.5 0 0 0 12 19.5'
    ),
    p(
      'M12 7.5a5.5 5.5 0 0 1 4.5-2.3h3.3a1 1 0 0 1 1 1v10.6a1 1 0 0 1-1 1h-3.3A5.5 5.5 0 0 1 12 19.5'
    ),
    l(12, 7.5, 12, 19.5),
  ],
  table: [
    r(3.5, 4.5, 17, 15, 2),
    l(3.5, 9, 20.5, 9),
    l(3.5, 14.25, 20.5, 14.25),
    l(9.5, 4.5, 9.5, 19.5),
    dot(6.5, 11.6, 1.5),
  ],

  // ── media ────────────────────────────────────────────────────
  image: [
    r(3.5, 4.5, 17, 15, 2.5),
    p('M4.5 18.5L9 12.5L12.2 16.7L14.5 13.9L19.8 18.5'),
    dot(16.25, 8.75, 1.75),
  ],
  // No accent: a failed image is a status, and status colour beats brand
  // colour — an amber "sun" here would read as decoration on a broken thing.
  broken_image: [r(3.5, 4.5, 17, 15, 2.5), p('M10.5 4.5l1.6 4.2-2.7 2 3 2.9-1.6 2 2.2 3.9')],
  movie: [
    r(3.5, 4.5, 17, 15, 2),
    l(3.5, 9.25, 20.5, 9.25),
    l(8.5, 4.5, 6.6, 9.25),
    l(13.5, 4.5, 11.6, 9.25),
    l(18.5, 4.5, 16.6, 9.25),
  ],
  video_file: [p(SHEET), p(SHEET_FOLD), { kind: 'path', d: 'M9.5 12v6.5l5.5-3.25Z', accent: true }],

  // ── file actions ─────────────────────────────────────────────
  upload_file: [p(SHEET), p(SHEET_FOLD), l(12, 18.5, 12, 11.5), p('M9 14.5 12 11.5 15 14.5')],
  note_add: [p(SHEET), p(SHEET_FOLD), l(12, 11.5, 12, 18.5), l(8.5, 15, 15.5, 15)],
  download: [
    p('M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15'),
    l(12, 3.5, 12, 14.5),
    p('M8 10.5 12 14.5 16 10.5'),
  ],
  upload: [
    p('M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15'),
    l(12, 14.5, 12, 3.5),
    p('M8 7.5 12 3.5 16 7.5'),
  ],
  inbox: [
    r(3.5, 4.5, 17, 15, 2.5),
    p('M3.5 14h4.2a1 1 0 0 1 1 .9 3.4 3.4 0 0 0 6.6 0 1 1 0 0 1 1-.9h4.2'),
    dot(12, 9.25, 1.75),
  ],

  // ── folders & containers ─────────────────────────────────────
  create_new_folder: [p(FOLDER), l(12, 10.5, 12, 16.5), l(9, 13.5, 15, 13.5)],
  // Teeth run across the track, not along it — a column of vertical dashes
  // collapses into an exclamation mark at small sizes.
  folder_zip: [p(FOLDER), p('M15.3 7.9h2.4M15.3 10.3h2.4M15.3 12.7h2.4'), dot(16.5, 16.2, 1.6)],
  archive: [
    r(3.5, 4.5, 17, 4, 1.5),
    p(BOX_BODY),
    l(12, 11.5, 12, 17),
    p('M9.5 14.5 12 17l2.5-2.5'),
  ],
  inventory_2: [r(3.5, 4.5, 17, 4, 1.5), p(BOX_BODY), l(9, 13, 13.5, 13), dot(15.5, 13, 1.5)],
  move_item: [
    r(3.5, 6, 12, 12, 2),
    dot(7.25, 12, 1.75),
    l(10.5, 12, 20.5, 12),
    p('M17.5 9 20.5 12 17.5 15'),
  ],

  // ── authoring & formats ──────────────────────────────────────
  draw: [
    p('M9.5 12.5 15.4 6.6a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L13.5 16.5Z'),
    l(11.5, 10.5, 15.5, 14.5),
    p('M4 19.5c1.6 0 2-2 3.6-2s2 2 3.6 2'),
  ],
  edit_note: [
    l(4.5, 7, 15, 7),
    l(4.5, 11, 12, 11),
    l(4.5, 15, 9.5, 15),
    p('M13 19.5h-2.5v-2.5l5.6-5.6a1.3 1.3 0 0 1 1.8 0l.7.7a1.3 1.3 0 0 1 0 1.8Z'),
  ],
  code: [p('M9 8.5 4.5 12 9 15.5'), p('M15 8.5 19.5 12 15 15.5'), l(13.5, 6.5, 10.5, 17.5)],
  data_object: [
    p(
      'M9.5 4.5H9a2.5 2.5 0 0 0-2.5 2.5v2.5A2.5 2.5 0 0 1 4 12a2.5 2.5 0 0 1 2.5 2.5V17A2.5 2.5 0 0 0 9 19.5h.5'
    ),
    p(
      'M14.5 4.5h.5A2.5 2.5 0 0 1 17.5 7v2.5A2.5 2.5 0 0 0 20 12a2.5 2.5 0 0 0-2.5 2.5V17a2.5 2.5 0 0 1-2.5 2.5h-.5'
    ),
    dot(12, 12, 1.75),
  ],
};
