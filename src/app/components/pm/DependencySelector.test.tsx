import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DependencySelector } from './DependencySelector';
import type { PmDependency } from '@/lib/tauri/pm';

const availableItems = [
  { id: 'e-1', type: 'epic' as const, name: 'Auth Epic' },
  { id: 'e-2', type: 'epic' as const, name: 'Dashboard Epic' },
  { id: 't-1', type: 'ticket' as const, name: 'Login ticket' },
  { id: 't-2', type: 'ticket' as const, name: 'Signup ticket' },
];

const makeDep = (overrides: Partial<PmDependency> = {}): PmDependency => ({
  id: 'dep-1',
  sourceType: 'ticket',
  sourceId: 'current-item',
  targetType: 'epic',
  targetId: 'e-1',
  ...overrides,
});

describe('DependencySelector', () => {
  const defaultProps = {
    dependencies: [] as PmDependency[],
    availableItems,
    currentItemId: 'current-item',
    onAdd: vi.fn(),
    onRemove: vi.fn(),
  };

  it('renders "No dependencies" when empty', () => {
    render(<DependencySelector {...defaultProps} />);
    expect(screen.getByText('No dependencies')).toBeDefined();
  });

  it('renders dependency tags', () => {
    const deps = [makeDep({ id: 'dep-1', targetId: 'e-1' })];
    render(<DependencySelector {...defaultProps} dependencies={deps} />);
    expect(screen.getByText('Auth Epic')).toBeDefined();
  });

  it('calls onRemove when tag remove button clicked', () => {
    const onRemove = vi.fn();
    const deps = [makeDep({ id: 'dep-1', targetId: 'e-1' })];
    render(<DependencySelector {...defaultProps} dependencies={deps} onRemove={onRemove} />);

    const removeBtn = screen.getByRole('button', { name: /remove dependency/i });
    fireEvent.click(removeBtn);

    expect(onRemove).toHaveBeenCalledWith('dep-1');
  });

  it('shows dropdown with available items', () => {
    render(<DependencySelector {...defaultProps} />);

    const select = screen.getByRole('combobox');
    expect(select).toBeDefined();

    // Should have the placeholder + available items (minus self)
    const options = select.querySelectorAll('option');
    // 1 placeholder + 4 items minus current-item (which isn't in the list) = 5
    expect(options.length).toBe(5);
  });

  it('filters out already-added items from dropdown', () => {
    const deps = [makeDep({ id: 'dep-1', targetId: 'e-1' })];
    render(<DependencySelector {...defaultProps} dependencies={deps} />);

    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option'));
    const optionTexts = options.map((o) => o.textContent);

    expect(optionTexts).not.toContain('Auth Epic');
    expect(optionTexts).toContain('Dashboard Epic');
  });

  it('filters out self from dropdown', () => {
    render(<DependencySelector {...defaultProps} currentItemId="e-1" />);

    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option'));
    const optionValues = options.map((o) => o.getAttribute('value')).filter(Boolean);

    expect(optionValues).not.toContain('e-1');
  });

  it('calls onAdd when selecting from dropdown', () => {
    const onAdd = vi.fn();
    // Mock crypto.randomUUID
    vi.stubGlobal('crypto', { randomUUID: () => 'generated-uuid' });

    render(<DependencySelector {...defaultProps} onAdd={onAdd} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'e-2' } });

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated-uuid',
        targetId: 'e-2',
        targetType: 'epic',
      })
    );

    vi.unstubAllGlobals();
  });

  it('filters dropdown items based on search input', () => {
    render(<DependencySelector {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText(/search dependencies/i);
    expect(searchInput).toBeDefined();

    fireEvent.change(searchInput, { target: { value: 'Auth' } });

    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option')).filter(
      (o) => o.getAttribute('value') !== ''
    );

    expect(options.length).toBe(1);
    expect(options[0].textContent).toBe('Auth Epic');

    fireEvent.change(searchInput, { target: { value: 'non-existent' } });
    const options2 = Array.from(select.querySelectorAll('option')).filter(
      (o) => o.getAttribute('value') !== ''
    );
    expect(options2.length).toBe(0);
  });
});
