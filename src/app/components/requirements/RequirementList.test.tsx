import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementList } from './RequirementList';
import type { PmRequirement } from '@/lib/tauri/requirements';

function makeRequirement(overrides: Partial<PmRequirement> = {}): PmRequirement {
  return {
    id: 'r1',
    reqId: 'REQ-AUTH-01',
    title: 'User Login',
    description: 'Users must log in',
    type: 'functional',
    category: 'auth',
    priority: 'normal',
    status: 'draft',
    rationale: 'Core feature',
    acceptanceCriteria: '- Can log in',
    source: 'spec.md',
    lastVerifiedAt: null,
    appliesTo: [],
    sortOrder: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('RequirementList', () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "No requirements match" when empty', () => {
    render(<RequirementList requirements={[]} selectedId={null} onSelect={onSelect} />);
    expect(screen.getByText(/No requirements match/)).toBeInTheDocument();
  });

  it('renders table headers', () => {
    render(
      <RequirementList requirements={[makeRequirement()]} selectedId={null} onSelect={onSelect} />
    );
    expect(screen.getByText('Req ID')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('renders requirement rows with correct data', () => {
    render(
      <RequirementList requirements={[makeRequirement()]} selectedId={null} onSelect={onSelect} />
    );
    expect(screen.getByText('REQ-AUTH-01')).toBeInTheDocument();
    expect(screen.getByText('User Login')).toBeInTheDocument();
    expect(screen.getByText('auth')).toBeInTheDocument();
    expect(screen.getByText('normal')).toBeInTheDocument();
  });

  it('type badge shows "FUNC" for functional', () => {
    render(
      <RequirementList requirements={[makeRequirement()]} selectedId={null} onSelect={onSelect} />
    );
    expect(screen.getByText('FUNC')).toBeInTheDocument();
  });

  it('type badge shows "NFR" for non_functional', () => {
    render(
      <RequirementList
        requirements={[makeRequirement({ type: 'non_functional' })]}
        selectedId={null}
        onSelect={onSelect}
      />
    );
    expect(screen.getByText('NFR')).toBeInTheDocument();
  });

  it('priority text has correct color class for critical', () => {
    render(
      <RequirementList
        requirements={[makeRequirement({ priority: 'critical' })]}
        selectedId={null}
        onSelect={onSelect}
      />
    );
    const td = screen.getByText('critical').closest('td');
    expect(td).toHaveClass('text-red-400');
  });

  it('priority text has correct color class for high', () => {
    render(
      <RequirementList
        requirements={[makeRequirement({ priority: 'high' })]}
        selectedId={null}
        onSelect={onSelect}
      />
    );
    const td = screen.getByText('high').closest('td');
    expect(td).toHaveClass('text-orange-400');
  });

  it('status dot has correct color class for draft', () => {
    render(
      <RequirementList requirements={[makeRequirement()]} selectedId={null} onSelect={onSelect} />
    );
    const row = screen.getByTestId('requirement-row-REQ-AUTH-01');
    const dot = row.querySelector('.rounded-full');
    expect(dot).toHaveClass('bg-gray-400');
  });

  it('status dot has correct color class for active', () => {
    render(
      <RequirementList
        requirements={[makeRequirement({ status: 'active' })]}
        selectedId={null}
        onSelect={onSelect}
      />
    );
    const row = screen.getByTestId('requirement-row-REQ-AUTH-01');
    const dot = row.querySelector('.rounded-full');
    expect(dot).toHaveClass('bg-blue-400');
  });

  it('clicking row calls onSelect(id)', async () => {
    const user = userEvent.setup();
    render(
      <RequirementList requirements={[makeRequirement()]} selectedId={null} onSelect={onSelect} />
    );
    await user.click(screen.getByTestId('requirement-row-REQ-AUTH-01'));
    expect(onSelect).toHaveBeenCalledWith('r1');
  });

  it('selected row has bg-primary/10 class', () => {
    render(
      <RequirementList requirements={[makeRequirement()]} selectedId="r1" onSelect={onSelect} />
    );
    const row = screen.getByTestId('requirement-row-REQ-AUTH-01');
    expect(row).toHaveClass('bg-primary/10');
  });

  it('long titles are truncated (max-w-[200px] class on td)', () => {
    render(
      <RequirementList requirements={[makeRequirement()]} selectedId={null} onSelect={onSelect} />
    );
    const titleTd = screen.getByText('User Login').closest('td');
    expect(titleTd).toHaveClass('max-w-[200px]');
    expect(titleTd).toHaveClass('truncate');
  });

  it('verification indicator shows dash for never verified', () => {
    render(
      <RequirementList
        requirements={[makeRequirement({ lastVerifiedAt: null })]}
        selectedId={null}
        onSelect={onSelect}
      />
    );
    const indicator = screen.getByTestId('verification-indicator-REQ-AUTH-01');
    expect(indicator.textContent).toBe('—');
  });

  it('verification indicator shows green dot for recently verified', () => {
    const recentDate = new Date(Date.now() - 5 * 86400000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    render(
      <RequirementList
        requirements={[makeRequirement({ lastVerifiedAt: recentDate })]}
        selectedId={null}
        onSelect={onSelect}
      />
    );
    const indicator = screen.getByTestId('verification-indicator-REQ-AUTH-01');
    const dot = indicator.querySelector('.rounded-full');
    expect(dot).toHaveClass('bg-green-400');
  });

  it('verification indicator shows amber dot for stale verification', () => {
    const oldDate = new Date(Date.now() - 31 * 86400000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    render(
      <RequirementList
        requirements={[makeRequirement({ lastVerifiedAt: oldDate })]}
        selectedId={null}
        onSelect={onSelect}
      />
    );
    const indicator = screen.getByTestId('verification-indicator-REQ-AUTH-01');
    const dot = indicator.querySelector('.rounded-full');
    expect(dot).toHaveClass('bg-amber-400');
  });

  it('renders Verified column header', () => {
    render(
      <RequirementList requirements={[makeRequirement()]} selectedId={null} onSelect={onSelect} />
    );
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });
});
