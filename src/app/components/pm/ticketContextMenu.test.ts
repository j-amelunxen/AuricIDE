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

  it('offers Discard on a live ticket and Reopen on a discarded one', () => {
    const onUpdate = vi.fn();
    const live = buildTicketStatusPriorityPowerOptions(ticket, onUpdate);
    expect(live.some((option) => 'label' in option && option.label === 'Discard')).toBe(true);

    const discarded = buildTicketStatusPriorityPowerOptions(
      { ...ticket, status: 'discarded' },
      onUpdate
    );
    expect(discarded).toContainEqual(expect.objectContaining({ label: 'Reopen' }));
    expect(discarded.some((option) => 'label' in option && option.label === 'Discard')).toBe(false);
  });

  it('offers Mark to Test from in_progress', () => {
    const options = buildTicketStatusPriorityPowerOptions(
      { ...ticket, status: 'in_progress' },
      vi.fn()
    );
    expect(options).toContainEqual(expect.objectContaining({ label: 'Mark to Test' }));
  });
});
