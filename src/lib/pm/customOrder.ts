/**
 * Custom list order for PM tickets and epics.
 *
 * sortOrder already lives on the row; this module is the one place that
 * moves a row and rewrites those numbers. The visible list may be a subset
 * (one epic's tickets): other rows keep their slots so an All-view order
 * does not collapse when you shuffle inside an epic.
 */

export type ListDropPlace = 'before' | 'after';

export function getListDropPlace(
  clientY: number,
  rect: { top: number; height: number }
): ListDropPlace {
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

/** A new array — never mutates `ids`. Unknown or self-drops return `ids`. */
export function moveId(
  ids: string[],
  fromId: string,
  toId: string,
  place: ListDropPlace
): string[] {
  if (fromId === toId) return ids;
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from === -1 || to === -1) return ids;

  const next = ids.filter((id) => id !== fromId);
  let insertAt = next.indexOf(toId);
  if (place === 'after') insertAt += 1;
  next.splice(insertAt, 0, fromId);
  return next;
}

/**
 * Writes a new custom order for `visibleOrderedIds` onto `items`.
 *
 * Visible rows keep the slots they already occupy in the full list; only
 * which visible row sits in which of those slots changes. Everything is then
 * numbered 0..n-1 so duplicate sortOrders (common on older rows) become a
 * total order after the first drag.
 */
export function applyVisibleOrder<T extends { id: string; sortOrder: number }>(
  items: T[],
  visibleOrderedIds: string[]
): T[] {
  if (visibleOrderedIds.length < 2) return items;

  const uniqueVisible = new Set(visibleOrderedIds);
  if (uniqueVisible.size !== visibleOrderedIds.length) return items;

  const byId = new Map(items.map((item) => [item.id, item]));
  for (const id of visibleOrderedIds) {
    if (!byId.has(id)) return items;
  }

  const global = items
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const slots: number[] = [];
  for (let i = 0; i < global.length; i++) {
    if (uniqueVisible.has(global[i].id)) slots.push(i);
  }
  if (slots.length !== visibleOrderedIds.length) return items;

  const nextGlobal = global.slice();
  visibleOrderedIds.forEach((id, i) => {
    nextGlobal[slots[i]] = byId.get(id)!;
  });

  const orderOf = new Map(nextGlobal.map((item, i) => [item.id, i]));
  return items.map((item) => {
    const sortOrder = orderOf.get(item.id);
    return sortOrder === undefined || sortOrder === item.sortOrder ? item : { ...item, sortOrder };
  });
}
