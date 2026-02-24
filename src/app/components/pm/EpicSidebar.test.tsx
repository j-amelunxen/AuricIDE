import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EpicSidebar } from './EpicSidebar';
import type { PmEpic, PmTicket } from '@/lib/tauri/pm';

const makeEpic = (overrides: Partial<PmEpic> = {}): PmEpic => ({
  id: 'epic-1',
  name: 'Auth Epic',
  description: 'Authentication',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeTicket = (overrides: Partial<PmTicket> = {}): PmTicket => ({
  id: 'tk-1',
  epicId: 'epic-1',
  name: 'Login',
  description: '',
  status: 'open',
  statusUpdatedAt: '',
  priority: 'normal',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('EpicSidebar', () => {
  const defaultProps = {
    epics: [] as PmEpic[],
    tickets: [] as PmTicket[],
    selectedEpicId: null as string | null,
    onSelectEpic: vi.fn(),
    onAddEpic: vi.fn(),
    onEditEpic: vi.fn(),
    onDeleteEpic: vi.fn(),
  };

  it('renders "All" filter', () => {
    render(<EpicSidebar {...defaultProps} />);
    expect(screen.getByText('All')).toBeDefined();
  });

  it('renders epic names', () => {
    const epics = [makeEpic({ id: 'e-1', name: 'Auth' }), makeEpic({ id: 'e-2', name: 'UI' })];
    render(<EpicSidebar {...defaultProps} epics={epics} />);
    expect(screen.getByText('Auth')).toBeDefined();
    expect(screen.getByText('UI')).toBeDefined();
  });

  it('shows ticket counts', () => {
    const epics = [makeEpic({ id: 'epic-1' })];
    const tickets = [
      makeTicket({ id: 'tk-1', epicId: 'epic-1' }),
      makeTicket({ id: 'tk-2', epicId: 'epic-1' }),
    ];
    render(<EpicSidebar {...defaultProps} epics={epics} tickets={tickets} />);
    // "All" shows total count 2, epic-1 shows 2
    const badges = screen.getAllByText('2');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('highlights selected epic', () => {
    const epics = [makeEpic({ id: 'epic-1', name: 'Auth' })];
    render(<EpicSidebar {...defaultProps} epics={epics} selectedEpicId="epic-1" />);
    const epicItem = screen.getByText('Auth').closest('[data-testid="epic-item-epic-1"]');
    expect(epicItem?.className).toContain('bg-primary/10');
  });

  it('calls onSelectEpic with null when "All" clicked', () => {
    const onSelectEpic = vi.fn();
    render(<EpicSidebar {...defaultProps} onSelectEpic={onSelectEpic} />);
    fireEvent.click(screen.getByText('All'));
    expect(onSelectEpic).toHaveBeenCalledWith(null);
  });

  it('calls onSelectEpic with id when epic clicked', () => {
    const onSelectEpic = vi.fn();
    const epics = [makeEpic({ id: 'epic-1', name: 'Auth' })];
    render(<EpicSidebar {...defaultProps} epics={epics} onSelectEpic={onSelectEpic} />);
    fireEvent.click(screen.getByText('Auth'));
    expect(onSelectEpic).toHaveBeenCalledWith('epic-1');
  });

  it('calls onAddEpic when + button clicked', () => {
    const onAddEpic = vi.fn();
    render(<EpicSidebar {...defaultProps} onAddEpic={onAddEpic} />);
    fireEvent.click(screen.getByLabelText('Add epic'));
    expect(onAddEpic).toHaveBeenCalled();
  });

  it('shows delete button on hover', () => {
    const epics = [makeEpic({ id: 'epic-1', name: 'Auth' })];
    render(<EpicSidebar {...defaultProps} epics={epics} />);
    const deleteBtn = screen.getByLabelText('Delete epic epic-1');
    expect(deleteBtn).toBeDefined();
  });

  it('calls onDeleteEpic when delete clicked', () => {
    const onDeleteEpic = vi.fn();
    const epics = [makeEpic({ id: 'epic-1', name: 'Auth' })];
    render(<EpicSidebar {...defaultProps} epics={epics} onDeleteEpic={onDeleteEpic} />);
    fireEvent.click(screen.getByLabelText('Delete epic epic-1'));
    expect(onDeleteEpic).toHaveBeenCalledWith('epic-1');
  });

  it('calls onEditEpic when edit clicked', () => {
    const onEditEpic = vi.fn();
    const epics = [makeEpic({ id: 'epic-1', name: 'Auth' })];
    render(<EpicSidebar {...defaultProps} epics={epics} onEditEpic={onEditEpic} />);
    fireEvent.click(screen.getByLabelText('Edit epic epic-1'));
    expect(onEditEpic).toHaveBeenCalledWith(epics[0]);
  });
});
