import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmContent } from './LlmContent';

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
  });

  it('renders loading initially', async () => {
    render(<LlmContent />);
    expect(screen.getByText(/Loading settings/i)).toBeDefined();
  });
});
