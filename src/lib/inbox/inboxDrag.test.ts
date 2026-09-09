import { describe, expect, it, vi } from 'vitest';
import {
  INBOX_ITEM_DRAG_MIME,
  INBOX_TASK_DRAG_MIME,
  INBOX_TICKET_DRAG_MIME,
  parseInboxTaskDragData,
  setInboxTaskDragData,
  type InboxTaskDragPayload,
} from './inboxDrag';

function mockDragEvent() {
  const store: Record<string, string> = {};
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn((key: string, val: string) => {
      store[key] = val;
    }),
    getData: vi.fn((key: string) => store[key] ?? ''),
  };
  return {
    event: { dataTransfer } as unknown as React.DragEvent,
    dataTransfer,
    store,
  };
}

describe('inboxDrag', () => {
  describe('setInboxTaskDragData', () => {
    it('encodes an inbox-item drag payload', () => {
      const { event, dataTransfer, store } = mockDragEvent();
      const payload: InboxTaskDragPayload = { type: 'inbox-item', id: 'task-123' };

      setInboxTaskDragData(event, payload);

      expect(dataTransfer.effectAllowed).toBe('move');
      expect(store[INBOX_TASK_DRAG_MIME]).toBe(JSON.stringify(payload));
      expect(store[INBOX_ITEM_DRAG_MIME]).toBe('task-123');
      expect(store['text/plain']).toBe('task-123');
    });

    it('encodes a ticket drag payload', () => {
      const { event, dataTransfer, store } = mockDragEvent();
      const payload: InboxTaskDragPayload = {
        type: 'ticket',
        projectPath: '/repos/alpha',
        ticketId: 't-99',
      };

      setInboxTaskDragData(event, payload);

      expect(dataTransfer.effectAllowed).toBe('move');
      expect(store[INBOX_TASK_DRAG_MIME]).toBe(JSON.stringify(payload));
      expect(store[INBOX_TICKET_DRAG_MIME]).toBe('/repos/alpha:t-99');
    });
  });

  describe('parseInboxTaskDragData', () => {
    it('parses from INBOX_TASK_DRAG_MIME', () => {
      const { event, store } = mockDragEvent();
      const payload: InboxTaskDragPayload = { type: 'inbox-item', id: 'item-1' };
      store[INBOX_TASK_DRAG_MIME] = JSON.stringify(payload);

      expect(parseInboxTaskDragData(event)).toEqual(payload);
    });

    it('parses from INBOX_ITEM_DRAG_MIME', () => {
      const { event, store } = mockDragEvent();
      store[INBOX_ITEM_DRAG_MIME] = 'item-42';

      expect(parseInboxTaskDragData(event)).toEqual({
        type: 'inbox-item',
        id: 'item-42',
      });
    });

    it('parses from INBOX_TICKET_DRAG_MIME', () => {
      const { event, store } = mockDragEvent();
      store[INBOX_TICKET_DRAG_MIME] = '/repos/alpha:t-55';

      expect(parseInboxTaskDragData(event)).toEqual({
        type: 'ticket',
        projectPath: '/repos/alpha',
        ticketId: 't-55',
      });
    });

    it('parses from JSON text/plain fallback', () => {
      const { event, store } = mockDragEvent();
      const payload: InboxTaskDragPayload = {
        type: 'ticket',
        projectPath: '/repos/beta',
        ticketId: 't-77',
      };
      store['text/plain'] = JSON.stringify(payload);

      expect(parseInboxTaskDragData(event)).toEqual(payload);
    });

    it('parses plain text id fallback as inbox-item', () => {
      const { event, store } = mockDragEvent();
      store['text/plain'] = 'item-plain';

      expect(parseInboxTaskDragData(event)).toEqual({
        type: 'inbox-item',
        id: 'item-plain',
      });
    });

    it('returns null when no valid data is present', () => {
      const { event } = mockDragEvent();
      expect(parseInboxTaskDragData(event)).toBeNull();
    });

    it('returns null when dataTransfer is missing', () => {
      const emptyEvent = {} as React.DragEvent;
      expect(parseInboxTaskDragData(emptyEvent)).toBeNull();
    });
  });
});
