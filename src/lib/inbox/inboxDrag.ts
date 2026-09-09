import type { DragEvent as ReactDragEvent } from 'react';

export const INBOX_TASK_DRAG_MIME = 'application/x-auric-inbox-task';
export const INBOX_ITEM_DRAG_MIME = 'application/x-auric-inbox-item';
export const INBOX_TICKET_DRAG_MIME = 'application/x-auric-inbox-ticket';

export interface InboxItemDragPayload {
  type: 'inbox-item';
  id: string;
}

export interface InboxTicketDragPayload {
  type: 'ticket';
  projectPath: string;
  ticketId: string;
}

export type InboxTaskDragPayload = InboxItemDragPayload | InboxTicketDragPayload;

type AnyDragEvent = ReactDragEvent | DragEvent;

/**
 * Attaches inbox task data to the DragEvent's dataTransfer.
 */
export function setInboxTaskDragData(event: AnyDragEvent, payload: InboxTaskDragPayload): void {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'move';
  const serialized = JSON.stringify(payload);
  event.dataTransfer.setData(INBOX_TASK_DRAG_MIME, serialized);
  if (payload.type === 'inbox-item') {
    event.dataTransfer.setData(INBOX_ITEM_DRAG_MIME, payload.id);
    event.dataTransfer.setData('text/plain', payload.id);
  } else {
    event.dataTransfer.setData(
      INBOX_TICKET_DRAG_MIME,
      `${payload.projectPath}:${payload.ticketId}`
    );
    event.dataTransfer.setData('text/plain', serialized);
  }
}

/**
 * Parses drag data from DragEvent.
 * Checks custom MIME types, JSON payload in text/plain, or raw item ID in text/plain.
 */
export function parseInboxTaskDragData(event: AnyDragEvent): InboxTaskDragPayload | null {
  if (!event.dataTransfer) return null;
  const taskData = event.dataTransfer.getData(INBOX_TASK_DRAG_MIME);
  if (taskData) {
    try {
      const parsed = JSON.parse(taskData);
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        return parsed as InboxTaskDragPayload;
      }
    } catch {
      // ignore
    }
  }
  const itemId = event.dataTransfer.getData(INBOX_ITEM_DRAG_MIME);
  if (itemId) {
    return { type: 'inbox-item', id: itemId };
  }
  const ticketData = event.dataTransfer.getData(INBOX_TICKET_DRAG_MIME);
  if (ticketData) {
    const colonIdx = ticketData.indexOf(':');
    if (colonIdx !== -1) {
      return {
        type: 'ticket',
        projectPath: ticketData.slice(0, colonIdx),
        ticketId: ticketData.slice(colonIdx + 1),
      };
    }
  }
  const plainText = event.dataTransfer.getData('text/plain');
  if (plainText) {
    try {
      const parsed = JSON.parse(plainText);
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        return parsed as InboxTaskDragPayload;
      }
    } catch {
      // not JSON
    }
    const trimmed = plainText.trim();
    if (trimmed) {
      return { type: 'inbox-item', id: trimmed };
    }
  }
  return null;
}
