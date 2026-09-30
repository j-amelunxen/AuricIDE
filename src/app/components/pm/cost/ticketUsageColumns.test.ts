import { describe, expect, it } from 'vitest';
import {
  parseTicketUsageColumns,
  serializeTicketUsageColumns,
  toggleTicketUsageColumn,
} from './ticketUsageColumns';

describe('ticket usage columns', () => {
  it('is off by default', () => {
    expect(parseTicketUsageColumns(null)).toEqual([]);
  });

  it('reads back what was written', () => {
    expect(parseTicketUsageColumns(serializeTicketUsageColumns(['cost', 'tokens']))).toEqual([
      'tokens',
      'cost',
    ]);
  });

  it('drops unknown names and treats damaged storage as the default', () => {
    expect(parseTicketUsageColumns('["cost","nonsense"]')).toEqual(['cost']);
    expect(parseTicketUsageColumns('not json')).toEqual([]);
    expect(parseTicketUsageColumns('{"cost":true}')).toEqual([]);
  });

  it('toggles a column on and off, keeping the canonical order', () => {
    expect(toggleTicketUsageColumn(['cost'], 'tokens')).toEqual(['tokens', 'cost']);
    expect(toggleTicketUsageColumn(['tokens', 'cost'], 'tokens')).toEqual(['cost']);
  });
});
