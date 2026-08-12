import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FindInFilesModal } from './FindInFilesModal';

const mockSearchInFiles = vi.fn();
vi.mock('@/lib/tauri/search', () => ({
  searchInFiles: (...args: unknown[]) => mockSearchInFiles(...args),
}));

describe('FindInFilesModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    rootPath: '/project',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchInFiles.mockResolvedValue([]);
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<FindInFilesModal {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing without a project open', () => {
    const { container } = render(<FindInFilesModal {...defaultProps} rootPath={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('exposes an accessible dialog', () => {
    render(<FindInFilesModal {...defaultProps} />);
    expect(screen.getByRole('dialog', { name: /find in files/i })).toBeInTheDocument();
  });

  it('shows a hint before anything is typed and does not search yet', () => {
    render(<FindInFilesModal {...defaultProps} />);
    expect(screen.getByText(/type to search file contents/i)).toBeInTheDocument();
    expect(mockSearchInFiles).not.toHaveBeenCalled();
  });

  it('searches after the debounce and groups results by file', async () => {
    const user = userEvent.setup();
    mockSearchInFiles.mockResolvedValue([
      { path: '/project/notes/a.md', line: 3, column: 8, lineText: 'the needle here' },
      { path: '/project/notes/a.md', line: 9, column: 1, lineText: 'needle again' },
      { path: '/project/b.md', line: 1, column: 1, lineText: 'needle at start' },
    ]);
    render(<FindInFilesModal {...defaultProps} />);

    await user.type(screen.getByPlaceholderText(/find in files/i), 'needle');

    await waitFor(() =>
      expect(mockSearchInFiles).toHaveBeenCalledWith('/project', 'needle', false)
    );
    expect(await screen.findByText('a.md')).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();
    expect(screen.getByText('the needle here')).toBeInTheDocument();
    expect(screen.getByText('needle again')).toBeInTheDocument();
    expect(screen.getByText(/3 matches in 2 files/i)).toBeInTheDocument();
  });

  it('toggles case-sensitive search', async () => {
    const user = userEvent.setup();
    render(<FindInFilesModal {...defaultProps} />);

    await user.click(screen.getByTitle(/match case/i));
    await user.type(screen.getByPlaceholderText(/find in files/i), 'Needle');

    await waitFor(() => expect(mockSearchInFiles).toHaveBeenCalledWith('/project', 'Needle', true));
  });

  it('navigates to the file and line when a result is clicked, then closes', async () => {
    const user = userEvent.setup();
    mockSearchInFiles.mockResolvedValue([
      { path: '/project/a.md', line: 5, column: 1, lineText: 'needle here' },
    ]);
    render(<FindInFilesModal {...defaultProps} />);

    await user.type(screen.getByPlaceholderText(/find in files/i), 'needle');
    await user.click(await screen.findByText('needle here'));

    expect(defaultProps.onNavigate).toHaveBeenCalledWith('/project/a.md', 5);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('navigates to the selected result on Enter', async () => {
    const user = userEvent.setup();
    mockSearchInFiles.mockResolvedValue([
      { path: '/project/a.md', line: 5, column: 1, lineText: 'needle here' },
    ]);
    render(<FindInFilesModal {...defaultProps} />);

    const input = screen.getByPlaceholderText(/find in files/i);
    await user.type(input, 'needle');
    await screen.findByText('needle here');
    await user.keyboard('{Enter}');

    expect(defaultProps.onNavigate).toHaveBeenCalledWith('/project/a.md', 5);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<FindInFilesModal {...defaultProps} />);

    await user.keyboard('{Escape}');

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows a no-matches message when the search comes back empty', async () => {
    const user = userEvent.setup();
    mockSearchInFiles.mockResolvedValue([]);
    render(<FindInFilesModal {...defaultProps} />);

    await user.type(screen.getByPlaceholderText(/find in files/i), 'nothing-matches-this');

    expect(await screen.findByText(/no matches for/i)).toBeInTheDocument();
  });
});
