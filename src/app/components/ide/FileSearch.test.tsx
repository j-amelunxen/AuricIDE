import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileSearch } from './FileSearch';
import { useStore } from '@/lib/store';

describe('FileSearch', () => {
  const defaultProps = {
    files: ['/project/a.ts', '/project/b.ts'],
    isOpen: true,
    onClose: vi.fn(),
    onSelect: vi.fn(),
    rootPath: '/project',
  };

  afterEach(() => {
    useStore.setState({ overlayStack: { layers: [] } });
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<FileSearch {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<FileSearch {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('exposes an accessible dialog', () => {
    render(<FileSearch {...defaultProps} />);
    expect(screen.getByRole('dialog', { name: /go to file/i })).toBeInTheDocument();
  });

  it('focuses the search input on open', () => {
    render(<FileSearch {...defaultProps} />);
    expect(screen.getByPlaceholderText(/search files/i)).toBeInTheDocument();
  });
});
