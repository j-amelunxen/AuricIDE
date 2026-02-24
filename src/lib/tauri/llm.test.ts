import { describe, it, expect, vi } from 'vitest';
import { llmCall } from './llm';

// Mock tauri's invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('llmCall IPC', () => {
  it('is a function', () => {
    expect(typeof llmCall).toBe('function');
  });
});
