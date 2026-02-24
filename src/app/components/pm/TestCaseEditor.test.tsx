import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TestCaseEditor } from './TestCaseEditor';
import type { PmTestCase } from '@/lib/tauri/pm';

const makeTestCase = (overrides: Partial<PmTestCase> = {}): PmTestCase => ({
  id: 'tc-1',
  ticketId: 'tk-1',
  title: 'Should render correctly',
  body: 'Given the component, when rendered, then it shows.',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('TestCaseEditor', () => {
  const defaultProps = {
    testCases: [] as PmTestCase[],
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  };

  it('renders "No test cases" when list is empty', () => {
    render(<TestCaseEditor {...defaultProps} />);
    expect(screen.getByText('No test cases')).toBeDefined();
  });

  it('renders test case titles and bodies', () => {
    const cases = [
      makeTestCase({ id: 'tc-1', title: 'First test', body: 'First body' }),
      makeTestCase({ id: 'tc-2', title: 'Second test', body: 'Second body' }),
    ];
    render(<TestCaseEditor {...defaultProps} testCases={cases} />);

    expect(screen.getByDisplayValue('First test')).toBeDefined();
    expect(screen.getByDisplayValue('First body')).toBeDefined();
    expect(screen.getByDisplayValue('Second test')).toBeDefined();
    expect(screen.getByDisplayValue('Second body')).toBeDefined();
  });

  it('calls onUpdate when title is changed', () => {
    const onUpdate = vi.fn();
    const cases = [makeTestCase()];
    render(<TestCaseEditor {...defaultProps} testCases={cases} onUpdate={onUpdate} />);

    const titleInput = screen.getByDisplayValue('Should render correctly');
    fireEvent.change(titleInput, { target: { value: 'Updated title' } });

    expect(onUpdate).toHaveBeenCalledWith('tc-1', { title: 'Updated title' });
  });

  it('calls onUpdate when body is changed', () => {
    const onUpdate = vi.fn();
    const cases = [makeTestCase()];
    render(<TestCaseEditor {...defaultProps} testCases={cases} onUpdate={onUpdate} />);

    const bodyInput = screen.getByDisplayValue(
      'Given the component, when rendered, then it shows.'
    );
    fireEvent.change(bodyInput, { target: { value: 'Updated body' } });

    expect(onUpdate).toHaveBeenCalledWith('tc-1', { body: 'Updated body' });
  });

  it('calls onDelete when delete button clicked', () => {
    const onDelete = vi.fn();
    const cases = [makeTestCase()];
    render(<TestCaseEditor {...defaultProps} testCases={cases} onDelete={onDelete} />);

    const deleteBtn = screen.getByRole('button', { name: /delete test case/i });
    fireEvent.click(deleteBtn);

    expect(onDelete).toHaveBeenCalledWith('tc-1');
  });

  it('calls onAdd when add button clicked', () => {
    const onAdd = vi.fn();
    render(<TestCaseEditor {...defaultProps} onAdd={onAdd} />);

    fireEvent.click(screen.getByText('+ Add Test Case'));
    expect(onAdd).toHaveBeenCalled();
  });

  it('shows "+ Add Test Case" button', () => {
    render(<TestCaseEditor {...defaultProps} />);
    expect(screen.getByText('+ Add Test Case')).toBeDefined();
  });
});
