import { describe, expect, it } from 'vitest';
import { trimmedCaptureTitle } from './captureInput';

describe('trimmedCaptureTitle', () => {
  it('trims leading and trailing whitespace', () => {
    expect(trimmedCaptureTitle('  Write the report  ')).toBe('Write the report');
  });

  it('rejects an empty string', () => {
    expect(trimmedCaptureTitle('')).toBeNull();
  });

  it('rejects a whitespace-only string', () => {
    expect(trimmedCaptureTitle('   \n\t  ')).toBeNull();
  });

  it('keeps internal whitespace intact', () => {
    expect(trimmedCaptureTitle('  Call   Alex  ')).toBe('Call   Alex');
  });
});
