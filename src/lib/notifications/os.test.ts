import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();
const mockIsGranted = vi.fn();
const mockRequest = vi.fn();

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: () => mockIsGranted(),
  requestPermission: () => mockRequest(),
  sendNotification: (payload: unknown) => mockSend(payload),
}));

import { deservesOsBanner, notifyOs, osBannerForBatch } from './os';

describe('deservesOsBanner', () => {
  // The fleet panel's rule, applied to the inbox: a run of green results must
  // not train the user to ignore the banner that finally matters.
  it.each([
    ['error', 'info'],
    ['warn', 'info'],
    ['info', 'ask'],
    ['success', 'ask'],
  ] as const)('raises one for severity %s / kind %s', (severity, kind) => {
    expect(deservesOsBanner(severity, kind, 'agent')).toBe(true);
  });

  it.each([
    ['info', 'info'],
    ['success', 'info'],
  ] as const)('stays quiet for severity %s / kind %s', (severity, kind) => {
    expect(deservesOsBanner(severity, kind, 'agent')).toBe(false);
  });

  // A reminder exists to interrupt. Its severity is `info` because nothing has
  // gone wrong, and staying quiet on that basis is how a reminder ends up only
  // reminding someone who was already looking.
  it('raises one for a schedule even though nothing is wrong', () => {
    expect(deservesOsBanner('info', 'info', 'system')).toBe(true);
  });
});

describe('osBannerForBatch', () => {
  const arrival = (overrides: Partial<Parameters<typeof osBannerForBatch>[0][number]> = {}) => ({
    severity: 'info' as const,
    kind: 'info' as const,
    source: 'system',
    title: 'Weekly changelog',
    body: 'Overdue since Monday',
    ...overrides,
  });

  it('words a single arrival as itself', () => {
    expect(osBannerForBatch([arrival()])).toEqual({
      title: 'Weekly changelog',
      body: 'Overdue since Monday',
    });
  });

  it('says nothing when nothing in the batch earns a banner', () => {
    expect(osBannerForBatch([arrival({ source: 'agent' })])).toBeNull();
  });

  it('ignores the arrivals that do not earn one when wording the batch', () => {
    expect(osBannerForBatch([arrival({ source: 'agent' }), arrival({ title: 'Backup' })])).toEqual({
      title: 'Backup',
      body: 'Overdue since Monday',
    });
  });

  // A machine asleep over a weekend hands over a stack at once, and a stack of
  // banners is a stack you dismiss without reading.
  it('collapses several arrivals into one counted line', () => {
    const banner = osBannerForBatch([
      arrival({ title: 'Backup' }),
      arrival({ title: 'Changelog' }),
      arrival({ title: 'Review' }),
      arrival({ title: 'Deploy' }),
    ]);

    expect(banner).toEqual({ title: '4 new notifications', body: 'Backup · Changelog · Review' });
  });
});

describe('notifyOs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGranted.mockResolvedValue(true);
    mockRequest.mockResolvedValue('granted');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });

  it('sends the banner while the window is in the background', async () => {
    await notifyOs('Titel', 'Text');
    expect(mockSend).toHaveBeenCalledWith({ title: 'Titel', body: 'Text' });
  });

  // A banner for something already on screen is the fastest way to teach
  // someone to dismiss banners unread.
  it('stays quiet while the window has focus', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await notifyOs('Titel', 'Text');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('asks for permission the first time', async () => {
    mockIsGranted.mockResolvedValue(false);
    await notifyOs('Titel', 'Text');
    expect(mockRequest).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalled();
  });

  it('sends nothing when permission is refused', async () => {
    mockIsGranted.mockResolvedValue(false);
    mockRequest.mockResolvedValue('denied');
    await notifyOs('Titel', 'Text');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not throw when the plugin fails', async () => {
    mockIsGranted.mockRejectedValue(new Error('no plugin'));
    await expect(notifyOs('Titel', 'Text')).resolves.toBeUndefined();
  });
});
