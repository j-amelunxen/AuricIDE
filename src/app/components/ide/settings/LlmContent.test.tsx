import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmContent } from './LlmContent';
import { dbGet } from '@/lib/tauri/db';

vi.mock('@/lib/store', () => ({
  useStore: vi.fn((fn) => fn({ rootPath: '/mock/path', setLlmConfigured: vi.fn() })),
}));

vi.mock('@/lib/tauri/db', () => ({
  dbGet: vi.fn().mockResolvedValue(''),
  dbSet: vi.fn().mockResolvedValue(undefined),
}));

describe('LlmContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dbGet).mockResolvedValue('');
  });

  it('renders loading initially', async () => {
    render(<LlmContent />);
    expect(screen.getByText(/Loading settings/i)).toBeDefined();
  });

  it('leaves the loading state and explains database failures', async () => {
    vi.mocked(dbGet).mockRejectedValueOnce(new Error('database unavailable'));
    render(<LlmContent />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading settings/i)).toBeNull();
      expect(screen.getByText(/Could not load LLM settings.*database unavailable/i)).toBeDefined();
    });
  });
});
