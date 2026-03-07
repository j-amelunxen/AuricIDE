import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementsModal } from './RequirementsModal';
import type { PmRequirement } from '@/lib/tauri/requirements';

const mockSetRequirementsModalOpen = vi.fn();
const mockLoadRequirements = vi.fn();
const mockSaveRequirements = vi.fn();
const mockDiscardRequirementChanges = vi.fn();
const mockAddRequirement = vi.fn();
const mockUpdateRequirement = vi.fn();
const mockDeleteRequirement = vi.fn();
const mockSetSelectedRequirementId = vi.fn();
const mockSetFilterCategory = vi.fn();
const mockSetFilterType = vi.fn();
const mockSetFilterStatus = vi.fn();
const mockSetSearchQuery = vi.fn();
const mockVerifyRequirement = vi.fn();
const mockSetFilterVerification = vi.fn();

const storeState = {
  requirementsModalOpen: false,
  requirementsDraft: [] as PmRequirement[],
  requirementsDirty: false,
  selectedRequirementId: null as string | null,
  rootPath: '/project',
  requirementFilterCategory: '',
  requirementFilterType: '',
  requirementFilterStatus: '',
  requirementFilterVerification: '',
  requirementSearchQuery: '',
  setRequirementsModalOpen: mockSetRequirementsModalOpen,
  loadRequirements: mockLoadRequirements,
  saveRequirements: mockSaveRequirements,
  discardRequirementChanges: mockDiscardRequirementChanges,
  addRequirement: mockAddRequirement,
  updateRequirement: mockUpdateRequirement,
  deleteRequirement: mockDeleteRequirement,
  verifyRequirement: mockVerifyRequirement,
  setSelectedRequirementId: mockSetSelectedRequirementId,
  setRequirementFilterCategory: mockSetFilterCategory,
  setRequirementFilterType: mockSetFilterType,
  setRequirementFilterStatus: mockSetFilterStatus,
  setRequirementFilterVerification: mockSetFilterVerification,
  setRequirementSearchQuery: mockSetSearchQuery,
};

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

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

describe('RequirementsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.requirementsModalOpen = false;
    storeState.requirementsDraft = [];
    storeState.requirementsDirty = false;
    storeState.selectedRequirementId = null;
    storeState.requirementFilterCategory = '';
    storeState.requirementFilterType = '';
    storeState.requirementFilterStatus = '';
    storeState.requirementFilterVerification = '';
    storeState.requirementSearchQuery = '';
  });

  it('renders nothing when closed', () => {
    const { container } = render(<RequirementsModal />);
    expect(container.innerHTML).toBe('');
  });

  it('renders modal when open', () => {
    storeState.requirementsModalOpen = true;
    render(<RequirementsModal />);
    expect(screen.getByTestId('requirements-modal')).toBeInTheDocument();
  });

  it('loads requirements on open', () => {
    storeState.requirementsModalOpen = true;
    render(<RequirementsModal />);
    expect(mockLoadRequirements).toHaveBeenCalledWith('/project');
  });

  it('shows empty state when no requirements', () => {
    storeState.requirementsModalOpen = true;
    render(<RequirementsModal />);
    expect(screen.getByTestId('requirement-list-empty')).toBeInTheDocument();
  });

  it('displays requirements in the list', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDraft = [makeRequirement()];
    render(<RequirementsModal />);
    expect(screen.getByTestId('requirement-row-REQ-AUTH-01')).toBeInTheDocument();
    expect(screen.getByText('User Login')).toBeInTheDocument();
  });

  it('shows save button when dirty', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDirty = true;
    render(<RequirementsModal />);
    expect(screen.getByTestId('requirements-save-btn')).toBeInTheDocument();
  });

  it('hides save button when not dirty', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDirty = false;
    render(<RequirementsModal />);
    expect(screen.queryByTestId('requirements-save-btn')).not.toBeInTheDocument();
  });

  it('calls close handler when close button clicked', async () => {
    storeState.requirementsModalOpen = true;
    const user = userEvent.setup();
    render(<RequirementsModal />);
    await user.click(screen.getByTestId('requirements-close-btn'));
    expect(mockSetRequirementsModalOpen).toHaveBeenCalledWith(false);
  });

  it('selects a requirement when row clicked', async () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDraft = [makeRequirement()];
    const user = userEvent.setup();
    render(<RequirementsModal />);
    await user.click(screen.getByTestId('requirement-row-REQ-AUTH-01'));
    expect(mockSetSelectedRequirementId).toHaveBeenCalledWith('r1');
  });

  it('shows detail panel when requirement selected', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDraft = [makeRequirement()];
    storeState.selectedRequirementId = 'r1';
    render(<RequirementsModal />);
    expect(screen.getByTestId('requirement-detail')).toBeInTheDocument();
  });

  it('shows empty detail when nothing selected', () => {
    storeState.requirementsModalOpen = true;
    render(<RequirementsModal />);
    expect(screen.getByTestId('requirement-detail-empty')).toBeInTheDocument();
  });

  it('opens create dialog when + New clicked', async () => {
    storeState.requirementsModalOpen = true;
    const user = userEvent.setup();
    render(<RequirementsModal />);
    await user.click(screen.getByTestId('requirements-create-btn'));
    expect(screen.getByTestId('requirement-create-dialog')).toBeInTheDocument();
  });

  it('filters by search query', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDraft = [
      makeRequirement({ id: 'r1', reqId: 'REQ-01', title: 'Login' }),
      makeRequirement({ id: 'r2', reqId: 'REQ-02', title: 'Logout' }),
    ];
    storeState.requirementSearchQuery = 'Logout';
    render(<RequirementsModal />);
    expect(screen.queryByTestId('requirement-row-REQ-01')).not.toBeInTheDocument();
    expect(screen.getByTestId('requirement-row-REQ-02')).toBeInTheDocument();
  });

  it('filters by category', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDraft = [
      makeRequirement({ id: 'r1', reqId: 'REQ-01', category: 'auth' }),
      makeRequirement({ id: 'r2', reqId: 'REQ-02', category: 'perf' }),
    ];
    storeState.requirementFilterCategory = 'auth';
    render(<RequirementsModal />);
    expect(screen.getByTestId('requirement-row-REQ-01')).toBeInTheDocument();
    expect(screen.queryByTestId('requirement-row-REQ-02')).not.toBeInTheDocument();
  });

  it('Escape closes modal when create dialog is not open', () => {
    storeState.requirementsModalOpen = true;
    render(<RequirementsModal />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(mockSetRequirementsModalOpen).toHaveBeenCalledWith(false);
  });

  it('Cmd+S saves when dirty', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDirty = true;
    render(<RequirementsModal />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }));
    expect(mockSaveRequirements).toHaveBeenCalledWith('/project');
  });

  it('Cmd+S does nothing when not dirty', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDirty = false;
    render(<RequirementsModal />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }));
    expect(mockSaveRequirements).not.toHaveBeenCalled();
  });

  it('Save button calls saveRequirements with rootPath', async () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDirty = true;
    const user = userEvent.setup();
    render(<RequirementsModal />);
    await user.click(screen.getByTestId('requirements-save-btn'));
    expect(mockSaveRequirements).toHaveBeenCalledWith('/project');
  });

  it('Delete flow: deleting selected requirement clears selection', async () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDraft = [makeRequirement({ id: 'r1', reqId: 'REQ-01' })];
    storeState.selectedRequirementId = 'r1';
    const user = userEvent.setup();
    render(<RequirementsModal />);
    await user.click(screen.getByTestId('detail-delete-btn'));
    expect(mockDeleteRequirement).toHaveBeenCalledWith('r1');
    expect(mockSetSelectedRequirementId).toHaveBeenCalledWith(null);
  });

  it('Type filter shows only matching requirements', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDraft = [
      makeRequirement({ id: 'r1', reqId: 'REQ-01', type: 'functional' }),
      makeRequirement({ id: 'r2', reqId: 'REQ-02', type: 'non_functional' }),
    ];
    storeState.requirementFilterType = 'non_functional';
    render(<RequirementsModal />);
    expect(screen.queryByTestId('requirement-row-REQ-01')).not.toBeInTheDocument();
    expect(screen.getByTestId('requirement-row-REQ-02')).toBeInTheDocument();
  });

  it('Status filter shows only matching requirements', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDraft = [
      makeRequirement({ id: 'r1', reqId: 'REQ-01', status: 'draft' }),
      makeRequirement({ id: 'r2', reqId: 'REQ-02', status: 'active' }),
    ];
    storeState.requirementFilterStatus = 'active';
    render(<RequirementsModal />);
    expect(screen.queryByTestId('requirement-row-REQ-01')).not.toBeInTheDocument();
    expect(screen.getByTestId('requirement-row-REQ-02')).toBeInTheDocument();
  });

  it('Combo filter: category + type + status', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDraft = [
      makeRequirement({
        id: 'r1',
        reqId: 'REQ-01',
        category: 'auth',
        type: 'functional',
        status: 'active',
      }),
      makeRequirement({
        id: 'r2',
        reqId: 'REQ-02',
        category: 'auth',
        type: 'non_functional',
        status: 'active',
      }),
      makeRequirement({
        id: 'r3',
        reqId: 'REQ-03',
        category: 'perf',
        type: 'functional',
        status: 'draft',
      }),
    ];
    storeState.requirementFilterCategory = 'auth';
    storeState.requirementFilterType = 'functional';
    storeState.requirementFilterStatus = 'active';
    render(<RequirementsModal />);
    expect(screen.getByTestId('requirement-row-REQ-01')).toBeInTheDocument();
    expect(screen.queryByTestId('requirement-row-REQ-02')).not.toBeInTheDocument();
    expect(screen.queryByTestId('requirement-row-REQ-03')).not.toBeInTheDocument();
  });

  it('Dirty indicator shows "unsaved" badge', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDirty = true;
    render(<RequirementsModal />);
    expect(screen.getByText('unsaved')).toBeInTheDocument();
  });

  it('Total count shows correct number', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDraft = [
      makeRequirement({ id: 'r1', reqId: 'REQ-01' }),
      makeRequirement({ id: 'r2', reqId: 'REQ-02' }),
      makeRequirement({ id: 'r3', reqId: 'REQ-03' }),
    ];
    render(<RequirementsModal />);
    expect(screen.getByText('3 total')).toBeInTheDocument();
  });

  it('Verification filter "unverified" shows only requirements with null lastVerifiedAt', () => {
    storeState.requirementsModalOpen = true;
    storeState.requirementsDraft = [
      makeRequirement({ id: 'r1', reqId: 'REQ-01', lastVerifiedAt: null }),
      makeRequirement({
        id: 'r2',
        reqId: 'REQ-02',
        lastVerifiedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      }),
    ];
    storeState.requirementFilterVerification = 'unverified';
    render(<RequirementsModal />);
    expect(screen.getByTestId('requirement-row-REQ-01')).toBeInTheDocument();
    expect(screen.queryByTestId('requirement-row-REQ-02')).not.toBeInTheDocument();
  });

  it('Verification filter "fresh" shows only recently verified requirements', () => {
    storeState.requirementsModalOpen = true;
    const recentDate = new Date(Date.now() - 5 * 86400000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    storeState.requirementsDraft = [
      makeRequirement({ id: 'r1', reqId: 'REQ-01', lastVerifiedAt: recentDate }),
      makeRequirement({ id: 'r2', reqId: 'REQ-02', lastVerifiedAt: null }),
    ];
    storeState.requirementFilterVerification = 'fresh';
    render(<RequirementsModal />);
    expect(screen.getByTestId('requirement-row-REQ-01')).toBeInTheDocument();
    expect(screen.queryByTestId('requirement-row-REQ-02')).not.toBeInTheDocument();
  });

  it('Verification filter "stale" shows only old verified requirements', () => {
    storeState.requirementsModalOpen = true;
    const oldDate = new Date(Date.now() - 31 * 86400000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    const recentDate = new Date(Date.now() - 5 * 86400000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    storeState.requirementsDraft = [
      makeRequirement({ id: 'r1', reqId: 'REQ-01', lastVerifiedAt: oldDate }),
      makeRequirement({ id: 'r2', reqId: 'REQ-02', lastVerifiedAt: recentDate }),
    ];
    storeState.requirementFilterVerification = 'stale';
    render(<RequirementsModal />);
    expect(screen.getByTestId('requirement-row-REQ-01')).toBeInTheDocument();
    expect(screen.queryByTestId('requirement-row-REQ-02')).not.toBeInTheDocument();
  });
});
