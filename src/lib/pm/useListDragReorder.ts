import { useState, type DragEvent } from 'react';
import { getListDropPlace, moveId, type ListDropPlace } from './customOrder';

/**
 * HTML5 drag-and-drop for a flat list. The same handlers drive tickets and
 * epics so a drop in either column rewrites sortOrder the same way.
 */
export function useListDragReorder(
  orderedIds: string[],
  onReorder: ((orderedIds: string[]) => void) | undefined,
  enabled = true
) {
  const canReorder = Boolean(enabled && onReorder);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; place: ListDropPlace } | null>(null);

  const clear = () => {
    setDraggedId(null);
    setDropTarget(null);
  };

  const onDragStart = (id: string, event: DragEvent<HTMLElement>) => {
    if (!canReorder) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
    setDraggedId(id);
  };

  const onDragOver = (id: string, event: DragEvent<HTMLElement>) => {
    if (!canReorder) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!draggedId || draggedId === id) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setDropTarget({ id, place: getListDropPlace(event.clientY, rect) });
  };

  const onDrop = (id: string, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const fromId = draggedId ?? event.dataTransfer.getData('text/plain');
    if (!canReorder || !onReorder || !fromId) {
      clear();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const place = getListDropPlace(event.clientY, rect);
    const next = moveId(orderedIds, fromId, id, place);
    if (next !== orderedIds) onReorder(next);
    clear();
  };

  return {
    draggedId,
    dropTarget,
    canReorder,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd: clear,
  };
}
