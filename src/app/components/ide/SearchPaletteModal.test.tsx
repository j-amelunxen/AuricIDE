import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchPaletteModal } from './SearchPaletteModal';
import { useStore } from '@/lib/store';

describe('SearchPaletteModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    ariaLabel: 'Search Palette',
    overlayId: 'test-search-palette',
    placeholder: 'Type something...',
    query: '',
    onQueryChange: vi.fn(),
  };

  afterEach(() => {
    useStore.setState({ overlayStack: { layers: [] } });
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<SearchPaletteModal {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders accessible dialog with provided aria-label', () => {
    render(
      <SearchPaletteModal {...defaultProps}>
        <div>Test Results</div>
      </SearchPaletteModal>
    );

    expect(screen.getByRole('dialog', { name: 'Search Palette' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type something...')).toBeInTheDocument();
    expect(screen.getByText('Test Results')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<SearchPaletteModal {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('triggers onQueryChange when user types in the input', () => {
    const onQueryChange = vi.fn();
    render(<SearchPaletteModal {...defaultProps} onQueryChange={onQueryChange} />);

    const input = screen.getByPlaceholderText('Type something...');
    fireEvent.change(input, { target: { value: 'hello' } });

    expect(onQueryChange).toHaveBeenCalledWith('hello');
  });

  it('renders custom headerExtra and footer stats', () => {
    render(
      <SearchPaletteModal
        {...defaultProps}
        headerExtra={<button data-testid="extra-btn">Extra</button>}
        footerRight={<span>42 results</span>}
      />
    );

    expect(screen.getByTestId('extra-btn')).toBeInTheDocument();
    expect(screen.getByText('42 results')).toBeInTheDocument();
  });
});
