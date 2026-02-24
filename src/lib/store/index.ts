import { create } from 'zustand';
import { createAgentSlice, type AgentSlice } from './agentSlice';
import { createCanvasSlice, type CanvasSlice } from './canvasSlice';
import { createFileTreeSlice, type FileTreeSlice } from './fileTreeSlice';
import { createGitSlice, type GitSlice } from './gitSlice';
import { createRecentProjectsSlice, type RecentProjectsSlice } from './recentProjectsSlice';
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

export type StoreState = FileTreeSlice &
  TabsSlice &
  GitSlice &
  AgentSlice &
  CanvasSlice &
  UISlice &
  RecentProjectsSlice &
  WikiLinkSlice &
  SlashCommandSlice &
  HeadingIndexSlice &
  EntityIndexSlice &
  DiagnosticsSlice &
  ProjectDbSlice &
  McpSlice &
  PmSlice &
  QASlice;

export const useStore = create<StoreState>()((...a) => ({
  ...createFileTreeSlice(...a),
  ...createTabsSlice(...a),
  ...createGitSlice(...a),
  ...createAgentSlice(...a),
  ...createCanvasSlice(...a),
  ...createUISlice(...a),
  ...createRecentProjectsSlice(...a),
  ...createWikiLinkSlice(...a),
  ...createSlashCommandSlice(...a),
  ...createHeadingIndexSlice(...a),
  ...createEntityIndexSlice(...a),
  ...createDiagnosticsSlice(...a),
  ...createProjectDbSlice(...a),
  ...createMcpSlice(...a),
  ...createPmSlice(...a),
  ...createQASlice(...a),
}));
