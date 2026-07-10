import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionControl } from './MissionControl';
import { useStore } from '@/lib/store';
import type { PmTicket } from '@/lib/tauri/pm';
import type { PmRequirement } from '@/lib/tauri/requirements';
import type { AgentInfo } from '@/lib/tauri/agents';

function makeTicket(overrides: Partial<PmTicket>): PmTicket {
  return {
    id: crypto.randomUUID(),
    epicId: 'e1',
    name: 'Ticket',
    description: '',
    status: 'open',
    statusUpdatedAt: new Date().toISOString(),
    sortOrder: 0,
    priority: 'normal',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

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

describe('MissionControl', () => {
  beforeEach(() => {
    useStore.setState({
      rootPath: '/tmp/demo-project',
      allFilePaths: [],
      pmDraftTickets: [],
      requirementsDraft: [],
      agents: [],
      goalsDraft: [],
      conductorRunning: false,
      conductorAssignments: {},
      conductorPendingApprovals: [],
      conductorDecisions: [],
      pmModalOpen: false,
      requirementsModalOpen: false,
      goalsModalOpen: false,
      importSpecDialogOpen: false,
      loadPmData: vi.fn(async () => {}),
      loadRequirements: vi.fn(async () => {}),
      loadGoals: vi.fn(async () => {}),
    });
  });

  it('renders the loop with all four stations', () => {
    render(<MissionControl />);
    expect(screen.getByTestId('mission-control')).toBeInTheDocument();
    expect(screen.getByTestId('mc-station-spec')).toBeInTheDocument();
    expect(screen.getByTestId('mc-station-plan')).toBeInTheDocument();
    expect(screen.getByTestId('mc-station-execute')).toBeInTheDocument();
    expect(screen.getByTestId('mc-station-verify')).toBeInTheDocument();
  });

  it('counts only markdown documents under specs/ at the spec station', () => {
    useStore.setState({
      allFilePaths: [
        '/p/specs/auth.md',
        '/p/specs/flows/checkout.markdown',
        '/p/specs/diagram.png',
        '/p/README.md',
        '/p/docs/notes.md',
        '/p/CHANGELOG.md',
      ],
    });
    render(<MissionControl />);
    expect(screen.getByTestId('mc-station-spec')).toHaveTextContent('2');
  });

  it('counts excalidraw diagrams under specs/ as specs too', () => {
    useStore.setState({
      allFilePaths: [
        '/p/specs/auth.md',
        '/p/specs/checkout-flow.excalidraw',
        '/p/other/diagram.excalidraw',
      ],
    });
    render(<MissionControl />);
    expect(screen.getByTestId('mc-station-spec')).toHaveTextContent('2');
  });

  it('shows zero at the spec station when the project has no specs directory', () => {
    useStore.setState({ allFilePaths: ['/p/README.md', '/p/docs/notes.md'] });
    render(<MissionControl />);
    expect(screen.getByTestId('mc-station-spec')).toHaveTextContent('0');
  });

  it('starts a new spec when the spec station is clicked', () => {
    const onCreateSpec = vi.fn();
    render(<MissionControl onCreateSpec={onCreateSpec} />);
    fireEvent.click(screen.getByTestId('mc-station-spec'));
    expect(onCreateSpec).toHaveBeenCalled();
  });

  it('counts open tickets at the plan station, ignoring done and archived', () => {
    useStore.setState({
      pmDraftTickets: [
        makeTicket({ status: 'open' }),
        makeTicket({ status: 'in_progress' }),
        makeTicket({ status: 'done' }),
        makeTicket({ status: 'archived' }),
      ],
    });
    render(<MissionControl />);
    expect(screen.getByTestId('mc-station-plan')).toHaveTextContent('2');
  });

  it('counts running agents at the execute station', () => {
    const base = { name: 'a', model: 'm', provider: 'p', startedAt: 0 };
    useStore.setState({
      agents: [
        { ...base, id: 'a1', status: 'running' } as AgentInfo,
        { ...base, id: 'a2', status: 'idle' } as AgentInfo,
      ],
    });
    render(<MissionControl />);
    expect(screen.getByTestId('mc-station-execute')).toHaveTextContent('1');
  });

  it('shows held vs total truths at the verify station', () => {
    useStore.setState({
      requirementsDraft: [
        makeRequirement({}),
        makeRequirement({ status: 'active', lastVerifiedAt: null }),
      ],
    });
    render(<MissionControl />);
    expect(screen.getByTestId('mc-station-verify')).toHaveTextContent('1/2');
  });

  it('opens the plan surface from the plan station and loads PM data', () => {
    const loadPmData = vi.fn(async () => {});
    useStore.setState({ loadPmData });
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-station-plan'));
    expect(useStore.getState().pmModalOpen).toBe(true);
    expect(loadPmData).toHaveBeenCalledWith('/tmp/demo-project');
  });

  it('opens the requirements surface from the verify station', () => {
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-station-verify'));
    expect(useStore.getState().requirementsModalOpen).toBe(true);
  });

  it('opens Goals & Orchestration from the execute station', () => {
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-station-execute'));
    expect(useStore.getState().goalsModalOpen).toBe(true);
  });

  it('embeds the conductor panel with full controls', () => {
    render(<MissionControl />);
    expect(screen.getByTestId('conductor-panel')).toBeInTheDocument();
  });

  it('offers the first-run path while the project has no plan yet', () => {
    render(<MissionControl />);
    const cta = screen.getByTestId('mc-import-spec');
    fireEvent.click(cta);
    expect(useStore.getState().importSpecDialogOpen).toBe(true);
  });

  it('hides the first-run hint once tickets exist', () => {
    useStore.setState({ pmDraftTickets: [makeTicket({})] });
    render(<MissionControl />);
    expect(screen.queryByTestId('mc-import-spec')).not.toBeInTheDocument();
  });

  it('opens the Excalidraw+ browser from the cockpit', () => {
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-excalidraw-browse'));
    expect(useStore.getState().excalidrawBrowserOpen).toBe(true);
  });

  it('flags decaying truths with a review shortcut', () => {
    useStore.setState({
      pmDraftTickets: [makeTicket({})],
      requirementsDraft: [makeRequirement({ status: 'active', lastVerifiedAt: null })],
    });
    render(<MissionControl />);
    const strip = screen.getByTestId('mc-truths-warning');
    expect(strip).toHaveTextContent('1');
    fireEvent.click(strip);
    expect(useStore.getState().requirementsModalOpen).toBe(true);
  });
});
