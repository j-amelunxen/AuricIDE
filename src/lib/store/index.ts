import { create } from 'zustand';
import { createAgentSlice, type AgentSlice } from './agentSlice';
import { createCanvasSlice, type CanvasSlice } from './canvasSlice';
import { createFileTreeSlice, type FileTreeSlice } from './fileTreeSlice';
import { createGitSlice, type GitSlice } from './gitSlice';
import { createRecentProjectsSlice, type RecentProjectsSlice } from './recentProjectsSlice';
import { createStarredProjectsSlice, type StarredProjectsSlice } from './starredProjectsSlice';
import { createTabsSlice, type TabsSlice } from './tabsSlice';
import { createUISlice, type UISlice } from './uiSlice';
import { createWikiLinkSlice, type WikiLinkSlice } from './wikiLinkSlice';
import { createSlashCommandSlice, type SlashCommandSlice } from './slashCommandSlice';
import { createHeadingIndexSlice, type HeadingIndexSlice } from './headingIndexSlice';
import { createEntityIndexSlice, type EntityIndexSlice } from './entityIndexSlice';
import { createDiagnosticsSlice, type DiagnosticsSlice } from './diagnosticsSlice';
import { createProjectDbSlice, type ProjectDbSlice } from './projectDbSlice';
import { createMcpSlice, type McpSlice } from './mcpSlice';
import { createPmSlice, type PmSlice } from './pmSlice';
import { createQASlice, type QASlice } from './qaSlice';
import { createBlueprintsSlice, type BlueprintsSlice } from './blueprintsSlice';
import { createObsidianCanvasSlice, type ObsidianCanvasSlice } from './obsidianCanvasSlice';
import { createRequirementsSlice, type RequirementsSlice } from './requirementsSlice';
import { createGoalsSlice, type GoalsSlice } from './goalsSlice';
import { createConductorSlice, type ConductorSlice } from './conductorSlice';
import { createToastSlice, type ToastSlice } from './toastSlice';
import { createExcalidrawSlice, type ExcalidrawSlice } from './excalidrawSlice';
import { createCommandUsageSlice, type CommandUsageSlice } from './commandUsageSlice';
import { createScratchSlice, type ScratchSlice } from './scratchSlice';

export type StoreState = FileTreeSlice &
  TabsSlice &
  GitSlice &
  AgentSlice &
  CanvasSlice &
  UISlice &
  RecentProjectsSlice &
  StarredProjectsSlice &
  WikiLinkSlice &
  SlashCommandSlice &
  HeadingIndexSlice &
  EntityIndexSlice &
  DiagnosticsSlice &
  ProjectDbSlice &
  McpSlice &
  PmSlice &
  QASlice &
  BlueprintsSlice &
  ObsidianCanvasSlice &
  RequirementsSlice &
  GoalsSlice &
  ConductorSlice &
  ToastSlice &
  ExcalidrawSlice &
  CommandUsageSlice &
  ScratchSlice;

export const useStore = create<StoreState>()((...a) => ({
  ...createFileTreeSlice(...a),
  ...createTabsSlice(...a),
  ...createGitSlice(...a),
  ...createAgentSlice(...a),
  ...createCanvasSlice(...a),
  ...createUISlice(...a),
  ...createRecentProjectsSlice(...a),
  ...createStarredProjectsSlice(...a),
  ...createWikiLinkSlice(...a),
  ...createSlashCommandSlice(...a),
  ...createHeadingIndexSlice(...a),
  ...createEntityIndexSlice(...a),
  ...createDiagnosticsSlice(...a),
  ...createProjectDbSlice(...a),
  ...createMcpSlice(...a),
  ...createPmSlice(...a),
  ...createQASlice(...a),
  ...createBlueprintsSlice(...a),
  ...createObsidianCanvasSlice(...a),
  ...createRequirementsSlice(...a),
  ...createGoalsSlice(...a),
  ...createConductorSlice(...a),
  ...createToastSlice(...a),
  ...createCommandUsageSlice(...a),
  ...createExcalidrawSlice(...a),
  ...createScratchSlice(...a),
}));

// Dev-only: expose the store for debugging and browser-mode testing.
// Dead code in production builds (NODE_ENV check is inlined at build time).
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__AURIC_STORE__ = useStore;
}
