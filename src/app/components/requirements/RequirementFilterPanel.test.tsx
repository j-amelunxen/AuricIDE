import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementFilterPanel } from './RequirementFilterPanel';

describe('RequirementFilterPanel', () => {
  const onCategoryChange = vi.fn();
  const onTypeChange = vi.fn();
  const onStatusChange = vi.fn();
  const onVerificationChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderPanel(overrides: Record<string, unknown> = {}) {
    const defaults = {
      categories: ['auth', 'perf'],
      activeCategory: '',
      activeType: '',
      activeStatus: '',
      activeVerification: '',
      onCategoryChange,
      onTypeChange,
      onStatusChange,
      onVerificationChange,
    };
    return render(<RequirementFilterPanel {...defaults} {...overrides} />);
  }

  it('renders all three sections (Category, Type, Status)', () => {
    renderPanel();
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('renders category chips from props plus All', () => {
    renderPanel({ categories: ['auth', 'perf', 'ui'] });
    const allButtons = screen.getAllByText('All');
    expect(allButtons.length).toBe(4); // one per section (Category, Type, Status, Verification)
    expect(screen.getByText('auth')).toBeInTheDocument();
    expect(screen.getByText('perf')).toBeInTheDocument();
    expect(screen.getByText('ui')).toBeInTheDocument();
  });

  it('All category chip is active by default (activeCategory="")', () => {
    renderPanel();
    const allButtons = screen.getAllByText('All');
    // The first "All" is the category one
    expect(allButtons[0].closest('button')).toHaveClass('bg-primary/20');
  });

  it('clicking a category chip calls onCategoryChange with that category', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByText('auth'));
    expect(onCategoryChange).toHaveBeenCalledWith('auth');
  });

  it('clicking active category chip calls onCategoryChange with "" (toggle off)', async () => {
    const user = userEvent.setup();
    renderPanel({ activeCategory: 'auth' });
    await user.click(screen.getByText('auth'));
    expect(onCategoryChange).toHaveBeenCalledWith('');
  });

  it('type section shows All, Functional, Non-Functional chips', () => {
    renderPanel();
    expect(screen.getByText('Functional')).toBeInTheDocument();
    expect(screen.getByText('Non-Functional')).toBeInTheDocument();
  });

  it('clicking active type chip toggles off', async () => {
    const user = userEvent.setup();
    renderPanel({ activeType: 'functional' });
    await user.click(screen.getByText('Functional'));
    expect(onTypeChange).toHaveBeenCalledWith('');
  });

  it('status section shows All, Draft, Active, Implemented, Verified, Deprecated', () => {
    renderPanel();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Implemented')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Deprecated')).toBeInTheDocument();
  });

  it('active chip has highlighted styling class (bg-primary/20)', () => {
    renderPanel({ activeType: 'functional' });
    const btn = screen.getByText('Functional').closest('button');
    expect(btn).toHaveClass('bg-primary/20');
  });

  it('renders Verification section with all chips', () => {
    renderPanel();
    expect(screen.getByText('Verification')).toBeInTheDocument();
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('clicking verification chip calls onVerificationChange', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByText('Fresh'));
    expect(onVerificationChange).toHaveBeenCalledWith('fresh');
  });

  it('clicking active verification chip toggles off', async () => {
    const user = userEvent.setup();
    renderPanel({ activeVerification: 'stale' });
    await user.click(screen.getByText('Stale'));
    expect(onVerificationChange).toHaveBeenCalledWith('');
  });
});
