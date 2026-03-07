import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementCreateDialog } from './RequirementCreateDialog';
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

describe('RequirementCreateDialog', () => {
  const onSave = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen=false', () => {
    const { container } = render(
      <RequirementCreateDialog
        isOpen={false}
        existingRequirements={[]}
        onSave={onSave}
        onClose={onClose}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when isOpen=true (in portal)', () => {
    render(
      <RequirementCreateDialog
        isOpen={true}
        existingRequirements={[]}
        onSave={onSave}
        onClose={onClose}
      />
    );
    expect(screen.getByTestId('requirement-create-dialog')).toBeInTheDocument();
    expect(screen.getByText('New Requirement')).toBeInTheDocument();
  });

  it('shows auto-generated reqId preview "REQ-01" with no category', () => {
    render(
      <RequirementCreateDialog
        isOpen={true}
        existingRequirements={[]}
        onSave={onSave}
        onClose={onClose}
      />
    );
    expect(screen.getByText('REQ-01')).toBeInTheDocument();
  });

  it('reqId preview updates when category typed: "REQ-AUTH-01"', async () => {
    const user = userEvent.setup();
    render(
      <RequirementCreateDialog
        isOpen={true}
        existingRequirements={[]}
        onSave={onSave}
        onClose={onClose}
      />
    );
    await user.type(screen.getByTestId('create-category-input'), 'auth');
    expect(screen.getByText('REQ-AUTH-01')).toBeInTheDocument();
  });

  it('reqId increments: existing "REQ-AUTH-01" shows "REQ-AUTH-02"', async () => {
    const user = userEvent.setup();
    const existing = [makeRequirement({ reqId: 'REQ-AUTH-01' })];
    render(
      <RequirementCreateDialog
        isOpen={true}
        existingRequirements={existing}
        onSave={onSave}
        onClose={onClose}
      />
    );
    await user.type(screen.getByTestId('create-category-input'), 'auth');
    expect(screen.getByText('REQ-AUTH-02')).toBeInTheDocument();
  });

  it('Title is required (save button disabled without title)', () => {
    render(
      <RequirementCreateDialog
        isOpen={true}
        existingRequirements={[]}
        onSave={onSave}
        onClose={onClose}
      />
    );
    expect(screen.getByTestId('create-save-btn')).toBeDisabled();
  });

  it('Save creates PmRequirement with correct data and calls onSave', async () => {
    const user = userEvent.setup();
    render(
      <RequirementCreateDialog
        isOpen={true}
        existingRequirements={[]}
        onSave={onSave}
        onClose={onClose}
      />
    );
    await user.type(screen.getByTestId('create-title-input'), 'My Requirement');
    await user.click(screen.getByTestId('create-save-btn'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as PmRequirement;
    expect(saved.id).toBeTruthy();
    expect(saved.reqId).toBe('REQ-01');
    expect(saved.title).toBe('My Requirement');
    expect(saved.status).toBe('draft');
    expect(saved.createdAt).toBeTruthy();
    expect(saved.updatedAt).toBeTruthy();
  });

  it('Cancel calls onClose', async () => {
    const user = userEvent.setup();
    render(
      <RequirementCreateDialog
        isOpen={true}
        existingRequirements={[]}
        onSave={onSave}
        onClose={onClose}
      />
    );
    await user.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Backdrop click calls onClose', async () => {
    const user = userEvent.setup();
    render(
      <RequirementCreateDialog
        isOpen={true}
        existingRequirements={[]}
        onSave={onSave}
        onClose={onClose}
      />
    );
    const backdrop = screen.getByTestId('requirement-create-dialog');
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('created requirement includes lastVerifiedAt null and appliesTo', async () => {
    const user = userEvent.setup();
    render(
      <RequirementCreateDialog
        isOpen={true}
        existingRequirements={[]}
        onSave={onSave}
        onClose={onClose}
      />
    );
    await user.type(screen.getByTestId('create-title-input'), 'Test');
    await user.type(screen.getByTestId('create-applies-to-input'), 'src/auth/, src/lib/');
    await user.click(screen.getByTestId('create-save-btn'));
    const saved = onSave.mock.calls[0][0] as PmRequirement;
    expect(saved.lastVerifiedAt).toBeNull();
    expect(saved.appliesTo).toEqual(['src/auth/', 'src/lib/']);
  });

  it('Form resets after save', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <RequirementCreateDialog
        isOpen={true}
        existingRequirements={[]}
        onSave={onSave}
        onClose={onClose}
      />
    );
    await user.type(screen.getByTestId('create-title-input'), 'Test Title');
    await user.click(screen.getByTestId('create-save-btn'));
    expect(onSave).toHaveBeenCalledTimes(1);
    // Re-render as open again (simulating re-open)
    rerender(
      <RequirementCreateDialog
        isOpen={true}
        existingRequirements={[]}
        onSave={onSave}
        onClose={onClose}
      />
    );
    expect(screen.getByTestId('create-title-input')).toHaveValue('');
  });
});
