import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExcalidrawContent } from './ExcalidrawContent';
import { useStore } from '@/lib/store';

const mockDbGet = vi.fn();
const mockDbSet = vi.fn();
vi.mock('@/lib/tauri/db', () => ({
  dbGet: (...args: unknown[]) => mockDbGet(...args),
  dbSet: (...args: unknown[]) => mockDbSet(...args),
}));

const mockTestConnection = vi.fn();
vi.mock('@/lib/tauri/excalidraw', () => ({
  excalidrawTestConnection: (...args: unknown[]) => mockTestConnection(...args),
}));

const mockDialogMessage = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  message: (...args: unknown[]) => mockDialogMessage(...args),
}));

describe('ExcalidrawContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbGet.mockResolvedValue(null);
    useStore.setState({ rootPath: '/tmp/project' });
  });

  it('loads the stored API key from excalidraw_settings', async () => {
    mockDbGet.mockResolvedValue('exc_live_123');
    render(<ExcalidrawContent />);
    await waitFor(() => {
      expect(screen.getByTestId('excalidraw-api-key')).toHaveValue('exc_live_123');
    });
    expect(mockDbGet).toHaveBeenCalledWith('/tmp/project', 'excalidraw_settings', 'api_key');
  });

  it('persists the API key on change', async () => {
    const user = userEvent.setup();
    render(<ExcalidrawContent />);
    await waitFor(() => expect(screen.getByTestId('excalidraw-api-key')).toBeInTheDocument());

    await user.type(screen.getByTestId('excalidraw-api-key'), 'k');

    await waitFor(() => {
      expect(mockDbSet).toHaveBeenCalledWith('/tmp/project', 'excalidraw_settings', 'api_key', 'k');
    });
  });

  it('masks the API key input', async () => {
    render(<ExcalidrawContent />);
    await waitFor(() => {
      expect(screen.getByTestId('excalidraw-api-key')).toHaveAttribute('type', 'password');
    });
  });

  it('reports a successful connection test', async () => {
    const user = userEvent.setup();
    mockTestConnection.mockResolvedValue('Connected to Excalidraw+ — 2 collection(s) visible');
    render(<ExcalidrawContent />);
    await waitFor(() => expect(screen.getByTestId('excalidraw-test-connection')).toBeEnabled());

    await user.click(screen.getByTestId('excalidraw-test-connection'));

    await waitFor(() => {
      expect(mockTestConnection).toHaveBeenCalledWith('/tmp/project');
      expect(mockDialogMessage).toHaveBeenCalledWith(
        expect.stringContaining('Connected'),
        expect.objectContaining({ kind: 'info' })
      );
    });
  });

  it('surfaces the precise taxonomy error when the test fails', async () => {
    const user = userEvent.setup();
    mockTestConnection.mockRejectedValue(
      'EXCALIDRAW_AUTH: Excalidraw+ rejected the API key (HTTP 401)'
    );
    render(<ExcalidrawContent />);
    await waitFor(() => expect(screen.getByTestId('excalidraw-test-connection')).toBeEnabled());

    await user.click(screen.getByTestId('excalidraw-test-connection'));

    await waitFor(() => {
      expect(mockDialogMessage).toHaveBeenCalledWith(
        expect.stringContaining('EXCALIDRAW_AUTH'),
        expect.objectContaining({ kind: 'error' })
      );
    });
  });
});
