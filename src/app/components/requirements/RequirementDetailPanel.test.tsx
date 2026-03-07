import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementDetailPanel } from './RequirementDetailPanel';
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

describe('RequirementDetailPanel', () => {
  const onUpdate = vi.fn();
  const onDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Select a requirement to view details" when requirement is null', () => {
    render(<RequirementDetailPanel requirement={null} onUpdate={onUpdate} onDelete={onDelete} />);
    expect(screen.getByText('Select a requirement to view details')).toBeInTheDocument();
  });

  it('shows all fields when requirement provided', () => {
    const req = makeRequirement();
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    expect(screen.getByText('REQ-AUTH-01')).toBeInTheDocument();
    expect(screen.getByText('User Login')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('normal')).toBeInTheDocument();
    expect(screen.getByText('Functional')).toBeInTheDocument();
    expect(screen.getByText('auth')).toBeInTheDocument();
    expect(screen.getByText('spec.md')).toBeInTheDocument();
    expect(screen.getByText('Users must log in')).toBeInTheDocument();
    expect(screen.getByText('Core feature')).toBeInTheDocument();
    expect(screen.getByText('- Can log in')).toBeInTheDocument();
  });

  it('Edit button switches to edit mode', async () => {
    const user = userEvent.setup();
    const req = makeRequirement();
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    await user.click(screen.getByTestId('detail-edit-btn'));
    expect(screen.getByTestId('detail-title-input')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('Cancel in edit mode discards changes and returns to view mode', async () => {
    const user = userEvent.setup();
    const req = makeRequirement();
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    await user.click(screen.getByTestId('detail-edit-btn'));
    const input = screen.getByTestId('detail-title-input');
    await user.clear(input);
    await user.type(input, 'Changed');
    await user.click(screen.getByText('Cancel'));
    // Back to view mode, original title shown
    expect(screen.queryByTestId('detail-title-input')).not.toBeInTheDocument();
    expect(screen.getByText('User Login')).toBeInTheDocument();
  });

  it('Save in edit mode calls onUpdate with only changed fields', async () => {
    const user = userEvent.setup();
    const req = makeRequirement();
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    await user.click(screen.getByTestId('detail-edit-btn'));
    const input = screen.getByTestId('detail-title-input');
    await user.clear(input);
    await user.type(input, 'New Title');
    await user.click(screen.getByText('Save'));
    expect(onUpdate).toHaveBeenCalledWith('r1', { title: 'New Title' });
  });

  it('Save with no changes does not call onUpdate', async () => {
    const user = userEvent.setup();
    const req = makeRequirement();
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    await user.click(screen.getByTestId('detail-edit-btn'));
    await user.click(screen.getByText('Save'));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('Delete button calls onDelete(id)', async () => {
    const user = userEvent.setup();
    const req = makeRequirement();
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    await user.click(screen.getByTestId('detail-delete-btn'));
    expect(onDelete).toHaveBeenCalledWith('r1');
  });

  it('editing title updates draft', async () => {
    const user = userEvent.setup();
    const req = makeRequirement();
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    await user.click(screen.getByTestId('detail-edit-btn'));
    const input = screen.getByTestId('detail-title-input');
    await user.clear(input);
    await user.type(input, 'Updated');
    expect(input).toHaveValue('Updated');
  });

  it('shows "Never" when lastVerifiedAt is null', () => {
    const req = makeRequirement({ lastVerifiedAt: null });
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    expect(screen.getByTestId('detail-last-verified').textContent).toBe('Never');
  });

  it('shows formatted date when lastVerifiedAt is set', () => {
    const req = makeRequirement({ lastVerifiedAt: '2026-03-01 12:00:00' });
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    expect(screen.getByTestId('detail-last-verified').textContent).toBe('2026-03-01 12:00:00');
  });

  it('shows Verify Now button when onVerify is provided', () => {
    const onVerify = vi.fn();
    const req = makeRequirement();
    render(
      <RequirementDetailPanel
        requirement={req}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onVerify={onVerify}
      />
    );
    expect(screen.getByTestId('detail-verify-btn')).toBeInTheDocument();
  });

  it('does not show Verify Now button when onVerify is not provided', () => {
    const req = makeRequirement();
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    expect(screen.queryByTestId('detail-verify-btn')).not.toBeInTheDocument();
  });

  it('Verify Now calls onVerify with requirement id', async () => {
    const user = userEvent.setup();
    const onVerify = vi.fn();
    const req = makeRequirement();
    render(
      <RequirementDetailPanel
        requirement={req}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onVerify={onVerify}
      />
    );
    await user.click(screen.getByTestId('detail-verify-btn'));
    expect(onVerify).toHaveBeenCalledWith('r1');
  });

  it('shows appliesTo chips when paths are set', () => {
    const req = makeRequirement({ appliesTo: ['src/auth/', 'src/lib/login.ts'] });
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    expect(screen.getByText('src/auth/')).toBeInTheDocument();
    expect(screen.getByText('src/lib/login.ts')).toBeInTheDocument();
  });

  it('shows dash when appliesTo is empty', () => {
    const req = makeRequirement({ appliesTo: [] });
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    // The Applies To section should show a dash
    const appliesToSection = screen.getByText('Applies To').parentElement;
    expect(appliesToSection?.textContent).toContain('—');
  });

  it('shows "No linked tests" when no testCases provided', () => {
    const req = makeRequirement();
    render(<RequirementDetailPanel requirement={req} onUpdate={onUpdate} onDelete={onDelete} />);
    expect(screen.getByText('No linked tests')).toBeInTheDocument();
  });

  it('shows linked test case titles', () => {
    const req = makeRequirement();
    const testCases = [
      { id: 'tc1', title: 'Login test' },
      { id: 'tc2', title: 'Logout test' },
    ];
    render(
      <RequirementDetailPanel
        requirement={req}
        onUpdate={onUpdate}
        onDelete={onDelete}
        testCases={testCases}
      />
    );
    expect(screen.getByText('Login test')).toBeInTheDocument();
    expect(screen.getByText('Logout test')).toBeInTheDocument();
  });
});
