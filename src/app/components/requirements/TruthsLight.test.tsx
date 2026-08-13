import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TruthsLight } from './TruthsLight';
import { useStore } from '@/lib/store';
import type { PmRequirement } from '@/lib/tauri/requirements';

function makeRequirement(overrides: Partial<PmRequirement>): PmRequirement {
  return {
    id: crypto.randomUUID(),
    reqId: 'REQ-TEST-01',
    title: 'A truth',
    description: '',
    type: 'functional',
    category: 'test',
    priority: 'normal',
    status: 'verified',
    rationale: '',
    acceptanceCriteria: '',
    source: '',
    lastVerifiedAt: new Date().toISOString(),
    appliesTo: [],
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const DAYS = 86400000;

describe('TruthsLight', () => {
  beforeEach(() => {
    useStore.setState({
      requirementsDraft: [],
      requirementsModalOpen: false,
      rootPath: null,
    });
  });

  it('stays hidden while the project has no requirements', () => {
    render(<TruthsLight />);
    expect(screen.queryByTestId('truths-light')).not.toBeInTheDocument();
  });

  it('stays hidden while requirements are only drafts', () => {
    useStore.setState({ requirementsDraft: [makeRequirement({ status: 'draft' })] });
    render(<TruthsLight />);
    expect(screen.queryByTestId('truths-light')).not.toBeInTheDocument();
  });

  it('glows green while every requirement is verified', () => {
    useStore.setState({
      requirementsDraft: [
        makeRequirement({ lastVerifiedAt: new Date().toISOString() }),
        makeRequirement({ lastVerifiedAt: new Date(Date.now() - 5 * DAYS).toISOString() }),
      ],
    });
    render(<TruthsLight />);
    const light = screen.getByTestId('truths-light');
    expect(light).toHaveTextContent('2/2 verified');
    expect(screen.getByTestId('truths-light-dot')).toHaveClass('bg-green-400');
  });

  it('turns amber when a proof has gone stale (>30 days)', () => {
    useStore.setState({
      requirementsDraft: [
        makeRequirement({ lastVerifiedAt: new Date(Date.now() - 31 * DAYS).toISOString() }),
      ],
    });
    render(<TruthsLight />);
    expect(screen.getByTestId('truths-light')).toHaveTextContent('1 stale');
    expect(screen.getByTestId('truths-light-dot')).toHaveClass('bg-amber-400');
  });

  it('turns amber for active-but-unverified requirements', () => {
    useStore.setState({
      requirementsDraft: [
        makeRequirement({ status: 'active', lastVerifiedAt: null }),
        makeRequirement({ status: 'implemented', lastVerifiedAt: null }),
        makeRequirement({ lastVerifiedAt: new Date().toISOString() }),
      ],
    });
    render(<TruthsLight />);
    expect(screen.getByTestId('truths-light')).toHaveTextContent('2 stale');
  });

  it('ignores deprecated requirements entirely', () => {
    useStore.setState({
      requirementsDraft: [
        makeRequirement({ status: 'deprecated', lastVerifiedAt: null }),
        makeRequirement({ lastVerifiedAt: new Date().toISOString() }),
      ],
    });
    render(<TruthsLight />);
    expect(screen.getByTestId('truths-light')).toHaveTextContent('1/1 verified');
  });

  it('opens the requirements surface when clicked', () => {
    useStore.setState({
      requirementsDraft: [makeRequirement({ lastVerifiedAt: new Date().toISOString() })],
    });
    render(<TruthsLight />);
    fireEvent.click(screen.getByTestId('truths-light'));
    expect(useStore.getState().workPlaceOpen).toBe(true);
    expect(useStore.getState().workTab).toBe('requirements');
  });

  it('is reachable by an accessible label', () => {
    useStore.setState({
      requirementsDraft: [makeRequirement({ lastVerifiedAt: new Date().toISOString() })],
    });
    render(<TruthsLight />);
    expect(
      screen.getByRole('button', { name: 'Requirements verification status' })
    ).toBeInTheDocument();
  });
});
