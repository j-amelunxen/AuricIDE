import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();
const mockIsGranted = vi.fn();
const mockRequest = vi.fn();

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: () => mockIsGranted(),
  requestPermission: () => mockRequest(),
  sendNotification: (payload: unknown) => mockSend(payload),
}));

import { deservesOsBanner, notifyOs } from './os';

describe('deservesOsBanner', () => {
  // The fleet panel's rule, applied to the inbox: a run of green results must
  // not train the user to ignore the banner that finally matters.
  it.each([
    ['error', 'info'],
    ['warn', 'info'],
    ['info', 'ask'],
    ['success', 'ask'],
  ] as const)('raises one for severity %s / kind %s', (severity, kind) => {
    expect(deservesOsBanner(severity, kind)).toBe(true);
  });

  it.each([
    ['info', 'info'],
    ['success', 'info'],
  ] as const)('stays quiet for severity %s / kind %s', (severity, kind) => {
    expect(deservesOsBanner(severity, kind)).toBe(false);
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
