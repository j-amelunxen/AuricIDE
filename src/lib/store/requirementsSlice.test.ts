import { describe, expect, it, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import {
  createRequirementsSlice,
  type RequirementsSlice,
  getStaleRequirements,
  getUnverifiedRequirements,
  getTestLinksForRequirement,
} from './requirementsSlice';
import type {
  PmRequirement,
  PmRequirementTestLink,
  RequirementsState,
} from '../tauri/requirements';

const mockRequirementsLoad = vi.fn<(...args: unknown[]) => Promise<RequirementsState>>(() =>
  Promise.resolve({ requirements: [], testLinks: [] })
);
const mockRequirementsSave = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockRequirementsClear = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockInitProjectDb = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());

vi.mock('../tauri/requirements', () => ({
  requirementsLoad: (...args: unknown[]) => mockRequirementsLoad(...args),
  requirementsSave: (...args: unknown[]) => mockRequirementsSave(...args),
  requirementsClear: (...args: unknown[]) => mockRequirementsClear(...args),
}));

vi.mock('../tauri/db', () => ({
  initProjectDb: (...args: unknown[]) => mockInitProjectDb(...args),
}));

function createTestStore() {
  return create<RequirementsSlice>()((...a) => ({ ...createRequirementsSlice(...a) }));
}

function makeRequirement(overrides: Partial<PmRequirement> = {}): PmRequirement {
  return {
    id: 'r1',
    reqId: 'REQ-AUTH-01',
    title: 'User Login',
    description: 'Users must be able to log in',
    type: 'functional',
    category: 'auth',
    priority: 'normal',
    status: 'draft',
    rationale: 'Core feature',
    acceptanceCriteria: '- Can log in with email',
    source: 'spec.md',
    lastVerifiedAt: null,
    appliesTo: [],
    sortOrder: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function makeTestLink(requirementId: string, testCaseId: string): PmRequirementTestLink {
  return {
    id: crypto.randomUUID(),
    requirementId,
    testCaseId,
    createdAt: '2026-01-01 00:00:00',
  };
}

describe('requirementsSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- UI state ---

  it('setRequirementsModalOpen toggles modal', () => {
    const store = createTestStore();
    expect(store.getState().requirementsModalOpen).toBe(false);
    store.getState().setRequirementsModalOpen(true);
    expect(store.getState().requirementsModalOpen).toBe(true);
  });

  it('setSelectedRequirementId updates selected requirement', () => {
    const store = createTestStore();
    expect(store.getState().selectedRequirementId).toBeNull();
    store.getState().setSelectedRequirementId('r1');
    expect(store.getState().selectedRequirementId).toBe('r1');
  });

  // --- Filter state ---

  it('setRequirementFilterCategory updates category filter', () => {
    const store = createTestStore();
    store.getState().setRequirementFilterCategory('auth');
    expect(store.getState().requirementFilterCategory).toBe('auth');
  });

  it('setRequirementFilterType updates type filter', () => {
    const store = createTestStore();
    store.getState().setRequirementFilterType('functional');
    expect(store.getState().requirementFilterType).toBe('functional');
  });

  it('setRequirementFilterStatus updates status filter', () => {
    const store = createTestStore();
    store.getState().setRequirementFilterStatus('active');
    expect(store.getState().requirementFilterStatus).toBe('active');
  });

  it('setRequirementSearchQuery updates search query', () => {
    const store = createTestStore();
    store.getState().setRequirementSearchQuery('login');
    expect(store.getState().requirementSearchQuery).toBe('login');
  });

  // --- Add / Update / Delete ---

  it('addRequirement adds to draft and sets dirty', () => {
    const store = createTestStore();
    const req = makeRequirement();
    store.getState().addRequirement(req);
    expect(store.getState().requirementsDraft).toHaveLength(1);
    expect(store.getState().requirementsDraft[0].id).toBe('r1');
    expect(store.getState().requirementsDirty).toBe(true);
  });

  it('updateRequirement updates the correct draft', () => {
    const store = createTestStore();
    store.getState().addRequirement(makeRequirement({ id: 'r1' }));
    store.getState().addRequirement(makeRequirement({ id: 'r2', title: 'Other' }));
    store.getState().updateRequirement('r1', { title: 'Updated' });
    expect(store.getState().requirementsDraft.find((r) => r.id === 'r1')?.title).toBe('Updated');
    expect(store.getState().requirementsDraft.find((r) => r.id === 'r2')?.title).toBe('Other');
  });

  it('deleteRequirement removes from draft and sets dirty', () => {
    const store = createTestStore();
    store.getState().addRequirement(makeRequirement({ id: 'r1' }));
    store.getState().addRequirement(makeRequirement({ id: 'r2', reqId: 'REQ-02' }));
    store.getState().deleteRequirement('r1');
    expect(store.getState().requirementsDraft).toHaveLength(1);
    expect(store.getState().requirementsDraft[0].id).toBe('r2');
    expect(store.getState().requirementsDirty).toBe(true);
  });

  // --- Load / Save / Discard ---

  it('loadRequirements populates both persisted and draft', async () => {
    const req = makeRequirement();
    mockRequirementsLoad.mockResolvedValueOnce({ requirements: [req], testLinks: [] });

    const store = createTestStore();
    await store.getState().loadRequirements('/project');

    expect(mockInitProjectDb).toHaveBeenCalledWith('/project');
    expect(store.getState().requirements).toHaveLength(1);
    expect(store.getState().requirementsDraft).toHaveLength(1);
    expect(store.getState().requirementsDirty).toBe(false);
    expect(store.getState().currentRequirementsProject).toBe('/project');
  });

  it('loadRequirements preserves dirty draft when reloading the same project', async () => {
    const persistedReq = makeRequirement({ id: 'persisted' });
    const draftOnlyReq = makeRequirement({ id: 'draft-only', title: 'Unsaved' });
    mockRequirementsLoad.mockResolvedValueOnce({ requirements: [persistedReq], testLinks: [] });

    const store = createTestStore();
    store.setState({
      requirements: [persistedReq],
      requirementsDraft: [persistedReq, draftOnlyReq],
      requirementsDirty: true,
      currentRequirementsProject: '/project',
    });

    await store.getState().loadRequirements('/project');

    expect(store.getState().requirementsDraft).toContainEqual(draftOnlyReq);
    expect(store.getState().requirementsDirty).toBe(true);
    expect(store.getState().requirements).toEqual([persistedReq]);
    expect(store.getState().currentRequirementsProject).toBe('/project');
  });

  it('loadRequirements resets dirty draft when switching to a different project', async () => {
    const newReq = makeRequirement({ id: 'new-project-req', title: 'New' });
    const draftOnlyReq = makeRequirement({ id: 'draft-only', title: 'Unsaved' });
    mockRequirementsLoad.mockResolvedValueOnce({ requirements: [newReq], testLinks: [] });

    const store = createTestStore();
    store.setState({
      requirements: [],
      requirementsDraft: [draftOnlyReq],
      requirementsDirty: true,
      currentRequirementsProject: '/old-project',
    });

    await store.getState().loadRequirements('/new-project');

    expect(store.getState().requirementsDraft).toEqual([newReq]);
    expect(store.getState().requirementsDirty).toBe(false);
    expect(store.getState().currentRequirementsProject).toBe('/new-project');
  });

  it('saveRequirements calls IPC and syncs state', async () => {
    const store = createTestStore();
    store.getState().addRequirement(makeRequirement());
    expect(store.getState().requirementsDirty).toBe(true);

    await store.getState().saveRequirements('/project');

    expect(mockInitProjectDb).toHaveBeenCalledWith('/project');
    // IPC receives appliesTo serialized as a JSON string
    const expectedReqs = store.getState().requirements.map((r) => ({
      ...r,
      appliesTo: JSON.stringify(r.appliesTo),
    }));
    expect(mockRequirementsSave).toHaveBeenCalledWith('/project', {
      requirements: expectedReqs,
      testLinks: store.getState().requirementTestLinksDraft,
    });
    expect(store.getState().requirementsDirty).toBe(false);
    expect(store.getState().requirements).toEqual(store.getState().requirementsDraft);
  });

  it('clearRequirements calls IPC and resets state', async () => {
    const store = createTestStore();
    store.getState().addRequirement(makeRequirement());

    await store.getState().clearRequirements('/project');

    expect(mockInitProjectDb).toHaveBeenCalledWith('/project');
    expect(mockRequirementsClear).toHaveBeenCalledWith('/project');
    expect(store.getState().requirements).toHaveLength(0);
    expect(store.getState().requirementsDraft).toHaveLength(0);
    expect(store.getState().requirementsDirty).toBe(false);
  });

  it('discardRequirementChanges restores persisted state', () => {
    const store = createTestStore();
    const req = makeRequirement();

    store.setState({
      requirements: [req],
      requirementsDraft: [req],
      requirementsDirty: false,
    });

    store.getState().addRequirement(makeRequirement({ id: 'r2', reqId: 'REQ-02', title: 'New' }));
    expect(store.getState().requirementsDraft).toHaveLength(2);
    expect(store.getState().requirementsDirty).toBe(true);

    store.getState().discardRequirementChanges();
    expect(store.getState().requirementsDraft).toHaveLength(1);
    expect(store.getState().requirementsDraft[0].id).toBe('r1');
    expect(store.getState().requirementsDirty).toBe(false);
  });

  it('resetRequirementsInMemory clears all state', () => {
    const store = createTestStore();
    store.getState().addRequirement(makeRequirement());

    store.getState().resetRequirementsInMemory();

    expect(store.getState().requirements).toHaveLength(0);
    expect(store.getState().requirementsDraft).toHaveLength(0);
    expect(store.getState().requirementsDirty).toBe(false);
  });

  // --- testLinks ---

  it('loadRequirements populates testLinks from IPC', async () => {
    const req = makeRequirement();
    const link = makeTestLink('r1', 'tc1');
    mockRequirementsLoad.mockResolvedValueOnce({ requirements: [req], testLinks: [link] });

    const store = createTestStore();
    await store.getState().loadRequirements('/project');

    expect(store.getState().requirementTestLinks).toHaveLength(1);
    expect(store.getState().requirementTestLinksDraft).toHaveLength(1);
    expect(store.getState().requirementTestLinksDraft[0].testCaseId).toBe('tc1');
  });

  it('saveRequirements passes testLinks to IPC', async () => {
    const store = createTestStore();
    store.getState().addRequirement(makeRequirement());
    const link = makeTestLink('r1', 'tc1');
    store.setState({
      requirementTestLinksDraft: [link],
    });

    await store.getState().saveRequirements('/project');

    // IPC receives appliesTo serialized as a JSON string
    const expectedReqs = store.getState().requirements.map((r) => ({
      ...r,
      appliesTo: JSON.stringify(r.appliesTo),
    }));
    expect(mockRequirementsSave).toHaveBeenCalledWith('/project', {
      requirements: expectedReqs,
      testLinks: [link],
    });
  });

  // --- verifyRequirement ---

  it('verifyRequirement sets status to verified and updates lastVerifiedAt', () => {
    const store = createTestStore();
    const req = makeRequirement({ id: 'r1', status: 'implemented' });
    store.getState().addRequirement(req);

    store.getState().verifyRequirement('r1');

    const updated = store.getState().requirementsDraft.find((r) => r.id === 'r1');
    expect(updated?.status).toBe('verified');
    expect(updated?.lastVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(store.getState().requirementsDirty).toBe(true);
  });

  // --- requirementFilterVerification ---

  it('setRequirementFilterVerification updates verification filter', () => {
    const store = createTestStore();
    expect(store.getState().requirementFilterVerification).toBe('');
    store.getState().setRequirementFilterVerification('stale');
    expect(store.getState().requirementFilterVerification).toBe('stale');
  });

  // --- selector helpers ---

  describe('getStaleRequirements', () => {
    it('returns requirements verified longer ago than staleDays', () => {
      const oldDate = new Date(Date.now() - 31 * 86400000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
      const recentDate = new Date(Date.now() - 5 * 86400000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
      const reqs = [
        makeRequirement({ id: 'r1', status: 'verified', lastVerifiedAt: oldDate }),
        makeRequirement({ id: 'r2', status: 'verified', lastVerifiedAt: recentDate }),
        makeRequirement({ id: 'r3', status: 'active', lastVerifiedAt: oldDate }),
      ];
      const stale = getStaleRequirements(reqs, 30);
      expect(stale).toHaveLength(1);
      expect(stale[0].id).toBe('r1');
    });

    it('does not return verified requirements with null lastVerifiedAt as stale', () => {
      const reqs = [makeRequirement({ id: 'r1', status: 'verified', lastVerifiedAt: null })];
      expect(getStaleRequirements(reqs, 30)).toHaveLength(0);
    });
  });

  describe('getUnverifiedRequirements', () => {
    it('returns active and implemented requirements', () => {
      const reqs = [
        makeRequirement({ id: 'r1', status: 'active' }),
        makeRequirement({ id: 'r2', status: 'implemented' }),
        makeRequirement({ id: 'r3', status: 'verified' }),
        makeRequirement({ id: 'r4', status: 'draft' }),
      ];
      const unverified = getUnverifiedRequirements(reqs);
      expect(unverified.map((r) => r.id)).toEqual(['r1', 'r2']);
    });
  });

  describe('getTestLinksForRequirement', () => {
    it('returns only links matching the requirement id', () => {
      const links = [
        makeTestLink('r1', 'tc1'),
        makeTestLink('r2', 'tc2'),
        makeTestLink('r1', 'tc3'),
      ];
      const result = getTestLinksForRequirement(links, 'r1');
      expect(result).toHaveLength(2);
      expect(result.map((l) => l.testCaseId)).toEqual(['tc1', 'tc3']);
    });
  });
});
