import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LinkGraphModal } from './LinkGraphModal';

// Mock LinkGraphView to avoid pulling in ReactFlow/store dependencies
vi.mock('./LinkGraphView', () => ({
  LinkGraphView: ({
    onFileSelect,
    hideFullscreen,
  }: {
    onFileSelect?: (p: string) => void;
    hideFullscreen?: boolean;
  }) => (
    <div data-testid="link-graph-view" data-hide-fullscreen={hideFullscreen}>
      <button data-testid="mock-node" onClick={() => onFileSelect?.('/project/note.md')}>
        node
      </button>
    </div>
  ),
}));

describe('LinkGraphModal', () => {
  const onClose = vi.fn();
  const onFileSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <LinkGraphModal isOpen={false} onClose={onClose} onFileSelect={onFileSelect} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the modal when isOpen is true', () => {
    render(<LinkGraphModal isOpen={true} onClose={onClose} onFileSelect={onFileSelect} />);
    expect(screen.getByTestId('link-graph-modal-backdrop')).toBeDefined();
    expect(screen.getByText('Link Graph Overview')).toBeDefined();
  });

  it('passes hideFullscreen to LinkGraphView', () => {
    render(<LinkGraphModal isOpen={true} onClose={onClose} onFileSelect={onFileSelect} />);
    expect(screen.getByTestId('link-graph-view').dataset.hideFullscreen).toBe('true');
  });

  it('calls onClose when close button is clicked', () => {
    render(<LinkGraphModal isOpen={true} onClose={onClose} onFileSelect={onFileSelect} />);
    fireEvent.click(screen.getByTitle('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    render(<LinkGraphModal isOpen={true} onClose={onClose} onFileSelect={onFileSelect} />);
    fireEvent.click(screen.getByTestId('link-graph-modal-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close when inner content is clicked', () => {
    render(<LinkGraphModal isOpen={true} onClose={onClose} onFileSelect={onFileSelect} />);
    fireEvent.click(screen.getByText('Link Graph Overview'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    render(<LinkGraphModal isOpen={true} onClose={onClose} onFileSelect={onFileSelect} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onFileSelect and onClose when a node is selected', () => {
    render(<LinkGraphModal isOpen={true} onClose={onClose} onFileSelect={onFileSelect} />);
    fireEvent.click(screen.getByTestId('mock-node'));
    expect(onFileSelect).toHaveBeenCalledWith('/project/note.md');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows ESC keyboard hint', () => {
    render(<LinkGraphModal isOpen={true} onClose={onClose} onFileSelect={onFileSelect} />);
    expect(screen.getByText('ESC')).toBeDefined();
  });
});
