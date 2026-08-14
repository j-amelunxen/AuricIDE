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
      videoImportDialogOpen: false,
      loadPmData: vi.fn(async () => {}),
      loadRequirements: vi.fn(async () => {}),
      loadGoals: vi.fn(async () => {}),
      starredProjects: [],
      recentProjects: [],
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

  it('starts a new spec when the spec station is clicked and none exist', () => {
    const onCreateSpec = vi.fn();
    render(<MissionControl onCreateSpec={onCreateSpec} />);
    fireEvent.click(screen.getByTestId('mc-station-spec'));
    expect(onCreateSpec).toHaveBeenCalled();
  });

  it('opens an existing spec instead of creating when the count is a document', () => {
    const onCreateSpec = vi.fn();
    const selectFile = vi.fn();
    const openTab = vi.fn();
    useStore.setState({
      allFilePaths: ['/tmp/demo-project/specs/auth.md'],
      selectFile,
      openTab,
    });
    render(<MissionControl onCreateSpec={onCreateSpec} />);
    fireEvent.click(screen.getByTestId('mc-station-spec'));
    expect(onCreateSpec).not.toHaveBeenCalled();
    expect(selectFile).toHaveBeenCalledWith('/tmp/demo-project/specs/auth.md');
    expect(openTab).toHaveBeenCalled();
  });

  it('shows a picker instead of opening the first spec when two exist', () => {
    const selectFile = vi.fn();
    const openTab = vi.fn();
    useStore.setState({
      allFilePaths: [
        '/tmp/demo-project/specs/auth.md',
        '/tmp/demo-project/specs/flows/checkout.md',
      ],
      selectFile,
      openTab,
    });
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-station-spec'));
    expect(screen.getByTestId('mc-spec-picker')).toBeInTheDocument();
    expect(selectFile).not.toHaveBeenCalled();
    expect(openTab).not.toHaveBeenCalled();
    expect(screen.getByText('auth.md')).toBeInTheDocument();
    expect(screen.getByText('checkout.md')).toBeInTheDocument();
  });

  it('opens the chosen spec from the picker', () => {
    const selectFile = vi.fn();
    const openTab = vi.fn();
    useStore.setState({
      allFilePaths: [
        '/tmp/demo-project/specs/auth.md',
        '/tmp/demo-project/specs/flows/checkout.md',
      ],
      selectFile,
      openTab,
    });
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-station-spec'));
    fireEvent.click(screen.getByRole('option', { name: /checkout\.md/ }));
    expect(selectFile).toHaveBeenCalledWith('/tmp/demo-project/specs/flows/checkout.md');
    expect(openTab).toHaveBeenCalledWith({
      id: '/tmp/demo-project/specs/flows/checkout.md',
      path: '/tmp/demo-project/specs/flows/checkout.md',
      name: 'checkout.md',
    });
    expect(screen.queryByTestId('mc-spec-picker')).not.toBeInTheDocument();
  });

  it('dismisses the spec picker on Escape or outside click', () => {
    const selectFile = vi.fn();
    useStore.setState({
      allFilePaths: [
        '/tmp/demo-project/specs/auth.md',
        '/tmp/demo-project/specs/flows/checkout.md',
      ],
      selectFile,
    });
    const { rerender } = render(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-station-spec'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('mc-spec-picker')).not.toBeInTheDocument();
    expect(selectFile).not.toHaveBeenCalled();

    rerender(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-station-spec'));
    fireEvent.click(screen.getByLabelText('Dismiss spec picker'));
    expect(screen.queryByTestId('mc-spec-picker')).not.toBeInTheDocument();
  });

  it('creates a new spec from the picker', () => {
    const onCreateSpec = vi.fn();
    const selectFile = vi.fn();
    useStore.setState({
      allFilePaths: [
        '/tmp/demo-project/specs/auth.md',
        '/tmp/demo-project/specs/flows/checkout.md',
      ],
      selectFile,
    });
    render(<MissionControl onCreateSpec={onCreateSpec} />);
    fireEvent.click(screen.getByTestId('mc-station-spec'));
    fireEvent.click(screen.getByRole('button', { name: 'New spec' }));
    expect(onCreateSpec).toHaveBeenCalled();
    expect(selectFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mc-spec-picker')).not.toBeInTheDocument();
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

  it('opens Work → Tickets from the plan station and loads PM data', () => {
    const loadPmData = vi.fn(async () => {});
    useStore.setState({ loadPmData });
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-station-plan'));
    expect(useStore.getState().workPlaceOpen).toBe(true);
    expect(useStore.getState().workTab).toBe('tickets');
    expect(loadPmData).toHaveBeenCalledWith('/tmp/demo-project');
  });

  it('opens Work → Requirements from the verify station', () => {
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-station-verify'));
    expect(useStore.getState().workPlaceOpen).toBe(true);
    expect(useStore.getState().workTab).toBe('requirements');
  });

  it('opens the Agents panel from the execute station', () => {
    const onOpenAgents = vi.fn();
    render(<MissionControl onOpenAgents={onOpenAgents} />);
    fireEvent.click(screen.getByTestId('mc-station-execute'));
    expect(onOpenAgents).toHaveBeenCalled();
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

  it('keeps video import discoverable after first run', () => {
    useStore.setState({ pmDraftTickets: [makeTicket({})] });
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-import-video-persistent'));
    expect(useStore.getState().videoImportDialogOpen).toBe(true);
  });

  it('opens the Excalidraw+ browser from the cockpit', () => {
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('mc-excalidraw-browse'));
    expect(useStore.getState().excalidrawBrowserOpen).toBe(true);
  });

  it('renders Quick Access below the conductor and switches to a starred project', () => {
    const onSwitchProject = vi.fn();
    useStore.setState({
      starredProjects: [{ path: '/tmp/other-project', name: 'other-project', starredAt: 1 }],
    });
    render(<MissionControl onSwitchProject={onSwitchProject} />);
    expect(screen.getByTestId('quick-access')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('quick-access-tile-/tmp/other-project'));
    expect(onSwitchProject).toHaveBeenCalledWith('/tmp/other-project');
  });

  it('lets the supervisor star the current project from Quick Access', () => {
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('quick-access-add-current'));
    expect(useStore.getState().isProjectStarred('/tmp/demo-project')).toBe(true);
  });

  it('shows Recent Projects on the no-project welcome', () => {
    const onSwitchProject = vi.fn();
    useStore.setState({
      rootPath: null,
      recentProjects: [
        { path: '/Users/jen/my-app', name: 'my-app', openedAt: 1000 },
        { path: '/Users/jen/other', name: 'other', openedAt: 900 },
      ],
    });
    render(<MissionControl onSwitchProject={onSwitchProject} />);
    fireEvent.click(screen.getByTestId('project-switcher-tab-recent'));
    expect(screen.getByTestId('recent-projects')).toBeInTheDocument();
    expect(screen.getByText('my-app')).toBeInTheDocument();
    expect(screen.getByText('other')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('recent-tile-/Users/jen/my-app'));
    expect(onSwitchProject).toHaveBeenCalledWith('/Users/jen/my-app');
  });

  it('shows Recent Projects on Mission Control when a project is already open', () => {
    useStore.setState({
      recentProjects: [{ path: '/tmp/other-project', name: 'other-project', openedAt: 1 }],
    });
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('project-switcher-tab-recent'));
    expect(screen.getByTestId('recent-projects')).toBeInTheDocument();
    expect(screen.getByText('other-project')).toBeInTheDocument();
  });

  it('opens the project switcher on Quick Access, with the recents a tab away', () => {
    useStore.setState({
      recentProjects: [{ path: '/tmp/other-project', name: 'other-project', openedAt: 1 }],
    });
    render(<MissionControl />);
    expect(screen.getByTestId('quick-access')).toBeInTheDocument();
    expect(screen.queryByTestId('recent-projects')).not.toBeInTheDocument();
  });

  it('stars a recent project into Quick Access from Mission Control', () => {
    useStore.setState({
      recentProjects: [{ path: '/tmp/other-project', name: 'other-project', openedAt: 1 }],
    });
    render(<MissionControl />);
    fireEvent.click(screen.getByTestId('project-switcher-tab-recent'));
    fireEvent.click(screen.getByTestId('star-recent-/tmp/other-project'));
    expect(useStore.getState().isProjectStarred('/tmp/other-project')).toBe(true);
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
    expect(useStore.getState().workPlaceOpen).toBe(true);
    expect(useStore.getState().workTab).toBe('requirements');
  });
});
