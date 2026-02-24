import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrashBoundary } from './CrashBoundary';

vi.mock('@/lib/tauri/crashlog', () => ({
  reportFrontendCrash: vi.fn().mockResolvedValue('/logs/crash-123.log'),
}));

function BrokenChild(): React.ReactElement {
  throw new Error('Intentional test crash');
}

describe('CrashBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <CrashBoundary>
        <p>Hello World</p>
      </CrashBoundary>
    );
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('shows crash UI when a child throws', () => {
    // Suppress React error boundary console output in tests
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <CrashBoundary>
        <BrokenChild />
      </CrashBoundary>
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();

    spy.mockRestore();
  });
});
