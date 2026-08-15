import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDEOverlays } from './IDEOverlays';
import { useStore } from '@/lib/store';

// The overlays host mounts every modal in the app. This test is about one
// effect — which repo's prompt history the spawn dialog gets — so every child
// renders null and only the wiring is exercised. Every factory inlines its own
// stub: vi.mock is hoisted above any top-level const it would reference.
vi.mock('@/app/components/ide/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/app/components/ide/ContextMenu', () => ({ ContextMenu: () => null }));
vi.mock('@/app/components/explorer/NewItemModal', () => ({ NewItemModal: () => null }));
vi.mock('@/app/components/explorer/RenameItemModal', () => ({ RenameItemModal: () => null }));
vi.mock('@/app/components/ide/FileSearch', () => ({ FileSearch: () => null }));
vi.mock('@/app/components/ide/FileSelector', () => ({ FileSelector: () => null }));
vi.mock('@/app/components/ide/FindInFilesModal', () => ({ FindInFilesModal: () => null }));
vi.mock('@/app/components/ide/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('@/app/components/pm/ProjectManagerModal', () => ({ ProjectManagerModal: () => null }));
vi.mock('@/app/components/agents/SpawnAgentDialog', () => ({ SpawnAgentDialog: () => null }));
vi.mock('@/app/components/agents/ImportSpecDialog', () => ({ ImportSpecDialog: () => null }));
vi.mock('@/app/components/agents/GenerateDiagramDialog', () => ({
  GenerateDiagramDialog: () => null,
}));
vi.mock('@/app/components/agents/AgentTerminalModal', () => ({
  AgentTerminalModal: () => <div data-testid="mock-terminal-modal" />,
}));
vi.mock('@/app/components/graph/LinkGraphModal', () => ({ LinkGraphModal: () => null }));
vi.mock('@/app/components/blueprints/BlueprintsGallery', () => ({
  BlueprintsGallery: () => null,
}));
vi.mock('@/app/components/console/AgentConsole', () => ({
  AgentConsole: () => <div data-testid="mock-agent-console" />,
}));
vi.mock('@/app/components/dev/PerformanceMonitor', () => ({ PerformanceMonitor: () => null }));
vi.mock('@/app/components/videoImport/VideoImportDialog', () => ({
  VideoImportDialog: () => null,
}));

type OverlayProps = Parameters<typeof IDEOverlays>[0];

function renderOverlays(overrides: Partial<OverlayProps>) {
  const props = {
    spawnDialogOpen: true,
    rootPath: null,
    spawnAgentRepoPath: null,
    ticketCwd: null,
    recentProjects: [],
    ...overrides,
  } as unknown as OverlayProps;
  return render(<IDEOverlays {...props} />);
}

describe('IDEOverlays — prompt history follows the spawn target', () => {
  let loadPromptHistory: (projectPath: string) => Promise<void>;

  beforeEach(() => {
    loadPromptHistory = vi.fn(async (_projectPath: string) => {});
    useStore.setState({ loadPromptHistory, promptHistory: [], goalsDraft: [], agents: [] });
  });

  it('loads the history of the repo the agent will actually run in', () => {
    renderOverlays({ rootPath: '/open/project', spawnAgentRepoPath: '/other/repo' });
    expect(loadPromptHistory).toHaveBeenCalledWith('/other/repo');
  });

  it('prefers the ticket working directory over the open project', () => {
    renderOverlays({ rootPath: '/open/project', ticketCwd: '/ticket/repo' });
    expect(loadPromptHistory).toHaveBeenCalledWith('/ticket/repo');
  });

  it('falls back to the open project when nothing else is targeted', () => {
    renderOverlays({ rootPath: '/open/project' });
    expect(loadPromptHistory).toHaveBeenCalledWith('/open/project');
  });

  it('clears the history when launching without any project open', () => {
    // Welcome screen: no rootPath. Leaving the previous project's prompts in
    // place would offer them for a repo the agent never runs in.
    renderOverlays({ rootPath: null, spawnAgentRepoPath: null });
    expect(loadPromptHistory).toHaveBeenCalledWith('');
  });

  it('does not touch the history while the dialog is closed', () => {
    renderOverlays({ spawnDialogOpen: false, rootPath: '/open/project' });
    expect(loadPromptHistory).not.toHaveBeenCalled();
  });
});

describe('IDEOverlays — stacking order', () => {
  beforeEach(() => {
    useStore.setState({
      loadPromptHistory: vi.fn(async () => {}),
      promptHistory: [],
      goalsDraft: [],
      agents: [],
    });
  });

  // Both overlays share the same z-[var(--z-tool)] layer, so paint order
  // (DOM order) is what actually decides which one is visible — the later
  // sibling wins. "Open terminal" from the console must open a terminal the
  // user can actually see and answer Esc on, not one buried behind the still
  // full-screen console.
  it('mounts the Agent Console before the terminal modal, so the terminal paints on top', () => {
    renderOverlays({ rootPath: '/open/project' });

    const consoleNode = screen.getByTestId('mock-agent-console');
    const terminal = screen.getByTestId('mock-terminal-modal');
    expect(
      consoleNode.compareDocumentPosition(terminal) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
