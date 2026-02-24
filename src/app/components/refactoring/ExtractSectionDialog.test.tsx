import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExtractSectionDialog } from './ExtractSectionDialog';

describe('ExtractSectionDialog', () => {
  const defaultProps = {
    headingTitle: 'My Section',
    suggestedFileName: 'my-section.md',
    contentPreview: 'This is the first line of content in the section...',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders with suggested filename pre-filled', () => {
    render(<ExtractSectionDialog {...defaultProps} />);

    const input = screen.getByDisplayValue('my-section.md');
    expect(input).toBeDefined();
  });

  it('shows heading title', () => {
    render(<ExtractSectionDialog {...defaultProps} />);

    expect(screen.getByText(/My Section/)).toBeDefined();
  });

  it('shows content preview', () => {
    render(<ExtractSectionDialog {...defaultProps} contentPreview="Some preview content here" />);

    expect(screen.getByText('Some preview content here')).toBeDefined();
  });

  it('calls onConfirm with filename on submit', () => {
    const onConfirm = vi.fn();
    render(<ExtractSectionDialog {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByText('Extract'));
    expect(onConfirm).toHaveBeenCalledWith('my-section.md');
  });

  it('calls onConfirm with edited filename', () => {
    const onConfirm = vi.fn();
    render(<ExtractSectionDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByDisplayValue('my-section.md');
    fireEvent.change(input, { target: { value: 'custom-name.md' } });
    fireEvent.click(screen.getByText('Extract'));

    expect(onConfirm).toHaveBeenCalledWith('custom-name.md');
  });

  it('calls onCancel when cancel clicked', () => {
    const onCancel = vi.fn();
    render(<ExtractSectionDialog {...defaultProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables confirm when filename is empty', () => {
    render(<ExtractSectionDialog {...defaultProps} />);

    const input = screen.getByDisplayValue('my-section.md');
    fireEvent.change(input, { target: { value: '' } });

    const btn = screen.getByText('Extract');
    expect(btn.hasAttribute('disabled') || btn.closest('button')?.disabled).toBe(true);
  });

  it('disables confirm when filename is only whitespace', () => {
    render(<ExtractSectionDialog {...defaultProps} />);

    const input = screen.getByDisplayValue('my-section.md');
    fireEvent.change(input, { target: { value: '   ' } });

    const btn = screen.getByText('Extract');
    expect(btn.hasAttribute('disabled') || btn.closest('button')?.disabled).toBe(true);
  });
});
