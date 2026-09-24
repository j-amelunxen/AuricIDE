import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAppCredentials = vi.fn();
const setAppCredentials = vi.fn();
const sendPushoverTest = vi.fn();

vi.mock('@/lib/tauri/appCredentials', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri/appCredentials')>(
    '@/lib/tauri/appCredentials'
  );
  return {
    ...actual,
    loadAppCredentials: (...args: unknown[]) => loadAppCredentials(...args),
    setAppCredentials: (...args: unknown[]) => setAppCredentials(...args),
  };
});

vi.mock('@/lib/tauri/pushover', () => ({
  sendPushoverTest: () => sendPushoverTest(),
}));

import { PushoverContent } from './PushoverContent';

describe('PushoverContent', () => {
  beforeEach(() => {
    loadAppCredentials.mockReset().mockResolvedValue({});
    setAppCredentials.mockReset().mockResolvedValue(undefined);
    sendPushoverTest.mockReset().mockResolvedValue(undefined);
  });

  it('is disabled and routes warn plus error by default', async () => {
    render(<PushoverContent />);

    expect(await screen.findByTestId('pushover-enabled')).not.toBeChecked();
    expect(screen.getByTestId('pushover-minimum-severity')).toHaveValue('warn');
    expect(loadAppCredentials).toHaveBeenCalledWith('pushover_settings');
  });

  it('renders both credentials as password fields', async () => {
    loadAppCredentials.mockResolvedValue({ api_token: 'app-token', user_key: 'user-key' });
    render(<PushoverContent />);

    expect(await screen.findByTestId('pushover-api-token')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('pushover-user-key')).toHaveAttribute('type', 'password');
  });

  it('persists the complete configuration atomically only after Save', async () => {
    const user = userEvent.setup();
    loadAppCredentials.mockResolvedValue({ api_token: 'app-token', user_key: 'user-key' });
    render(<PushoverContent />);
    await screen.findByTestId('pushover-enabled');

    await user.click(screen.getByTestId('pushover-enabled'));
    await user.selectOptions(screen.getByTestId('pushover-minimum-severity'), 'error');
    expect(setAppCredentials).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /save configuration/i }));

    expect(setAppCredentials).toHaveBeenCalledWith(
      'pushover_settings',
      expect.objectContaining({ enabled: 'true', minimum_severity: 'error' })
    );
  });

  it('does not enable delivery without both credentials', async () => {
    const user = userEvent.setup();
    render(<PushoverContent />);
    const toggle = await screen.findByTestId('pushover-enabled');

    await user.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent(/both credentials/i);
  });

  it('sends a direct test without inserting an inbox notification', async () => {
    const user = userEvent.setup();
    loadAppCredentials.mockResolvedValue({ api_token: 'app-token', user_key: 'user-key' });
    render(<PushoverContent />);

    await user.click(await screen.findByRole('button', { name: /send test/i }));

    await waitFor(() => expect(sendPushoverTest).toHaveBeenCalledOnce());
    expect(screen.getByText(/test sent/i)).toBeInTheDocument();
  });
});
