import type { StoreState } from './types';

/**
 * Everything a project leaves in the store, dropped when another one opens.
 * One list, so a slice that keeps project data cannot be forgotten by one of
 * the ways a project is opened. (The page's own view state is reset beside it.)
 */
export function resetProjectState(
  state: Pick<
    StoreState,
    | 'closeAllTabs'
    | 'setFileTree'
    | 'clearLinkIndex'
    | 'clearEntityIndex'
    | 'resetPmInMemory'
    | 'resetGoalsInMemory'
    | 'resetBlueprintsInMemory'
    | 'resetRequirementsInMemory'
    | 'resetExcalidrawInMemory'
    | 'resetGitInMemory'
    | 'resetReviewInMemory'
    | 'resetMergeInMemory'
  >
): void {
  state.closeAllTabs();
  state.setFileTree([]);
  state.clearLinkIndex();
  state.clearEntityIndex();
  state.resetPmInMemory();
  state.resetGoalsInMemory();
  state.resetBlueprintsInMemory();
  state.resetRequirementsInMemory();
  state.resetExcalidrawInMemory();
  state.resetGitInMemory();
  state.resetReviewInMemory();
  state.resetMergeInMemory();
}

/**
 * Reads what the project keeps in its database: on opening it, and again when
 * something outside the IDE (an MCP server, an agent) wrote to it. A refresh
 * keeps the person's unsaved PM edits on top of what changed.
 */
export function loadProjectData(
  state: Pick<
    StoreState,
    'loadPmData' | 'refreshPmData' | 'loadRequirements' | 'loadGoals' | 'loadExcalidrawSpecLinks'
  >,
  projectPath: string,
  how: 'open' | 'refresh'
): void {
  void (how === 'open' ? state.loadPmData(projectPath) : state.refreshPmData(projectPath));
  void state.loadRequirements(projectPath);
  void state.loadGoals(projectPath);
  void state.loadExcalidrawSpecLinks(projectPath);
}
