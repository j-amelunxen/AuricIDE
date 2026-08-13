import { describe, expect, it, vi } from 'vitest';
import type { PmTicket } from '@/lib/tauri/pm';
import { buildTicketStatusPriorityPowerOptions } from './ticketContextMenu';

const ticket: PmTicket = {
  id: 't1',
  epicId: 'e1',
  name: 'Do it',
  description: '',
  status: 'open',
  statusUpdatedAt: '',
  priority: 'normal',
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
};

describe('buildTicketStatusPriorityPowerOptions', () => {
  it('labels the strength section Agent strength', () => {
    const options = buildTicketStatusPriorityPowerOptions(ticket, vi.fn());
    expect(options).toContainEqual(
      expect.objectContaining({ type: 'header', label: 'Agent strength' })
    );
    expect(options.some((option) => 'label' in option && option.label === 'Model Power')).toBe(
      false
    );
  });
});
