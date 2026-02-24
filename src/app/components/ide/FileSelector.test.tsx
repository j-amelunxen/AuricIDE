import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FileSelector } from './FileSelector';

describe('FileSelector', () => {
  const mockFiles = [
    { path: '/root/src/index.ts', extension: 'ts', line_count: 100 },
    { path: '/root/src/main.rs', extension: 'rs', line_count: 600 },
    { path: '/root/README.md', extension: 'md', line_count: 50 },
  ];

  it('renders nothing when closed', () => {
    const { container } = render(
      <FileSelector files={mockFiles} isOpen={false} onClose={() => {}} rootPath="/root" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders files list when open', () => {
    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText('main.rs')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('filters by extension', () => {
    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    const extInput = screen.getByPlaceholderText('e.g. ts, rs');
    fireEvent.change(extInput, { target: { value: 'rs' } });

    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
    expect(screen.getByText('main.rs')).toBeInTheDocument();
  });

  it('filters by min lines', () => {
    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    const minLinesInput = screen.getByPlaceholderText('0');
    fireEvent.change(minLinesInput, { target: { value: '500' } });

    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
    expect(screen.getByText('main.rs')).toBeInTheDocument();
  });

  it('copies to clipboard', () => {
    const writeTextMock = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    const copyButton = screen.getByText('Copy List to Clipboard');
    fireEvent.click(copyButton);

    const expected = ['/root/src/index.ts', '/root/src/main.rs', '/root/README.md'].join('\n');
    expect(writeTextMock).toHaveBeenCalledWith(expected);
  });
});
