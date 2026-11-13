import type { StateCreator } from 'zustand';
import type { StoreState } from './types';
import { createAgentSlice } from './agentSlice';
import { createAgentUsageSlice } from './agentUsageSlice';
import { createCanvasSlice } from './canvasSlice';
import { createFileTreeSlice } from './fileTreeSlice';
import { createGitSlice } from './gitSlice';
import { createRecentProjectsSlice } from './recentProjectsSlice';
import { createStarredProjectsSlice } from './starredProjectsSlice';
import { createTabsSlice } from './tabsSlice';
import { createUISlice } from './uiSlice';
import { createWikiLinkSlice } from './wikiLinkSlice';
import { createSlashCommandSlice } from './slashCommandSlice';
import { createEntityIndexSlice } from './entityIndexSlice';
import { createDiagnosticsSlice } from './diagnosticsSlice';
import { createProjectDbSlice } from './projectDbSlice';
import { createPmSlice } from './pmSlice';
import { createQASlice } from './qaSlice';
import { createBlueprintsSlice } from './blueprintsSlice';
import { createObsidianCanvasSlice } from './obsidianCanvasSlice';
import { createRequirementsSlice } from './requirementsSlice';
import { createGoalsSlice } from './goalsSlice';
import { createConductorSlice } from './conductorSlice';
import { createToastSlice } from './toastSlice';
import { createExcalidrawSlice } from './excalidrawSlice';
import { createCommandUsageSlice } from './commandUsageSlice';
import { createScratchSlice } from './scratchSlice';
import { createNotificationsSlice } from './notificationsSlice';
import { createInboxSlice } from './inboxSlice';
import { createSchedulesSlice } from './schedulesSlice';
import { createSkillComboSlice } from './skillComboSlice';
import { createUsageLimitsSlice } from './usageLimitsSlice';
import { createOverlaySlice } from '@/lib/overlays/overlaySlice';
import { createLaneSummariesSlice } from './laneSummariesSlice';
import { createMergeSlice } from './mergeSlice';
import { createReviewSlice } from './reviewSlice';
import { createGitGraphSlice } from './gitGraphSlice';

export const createStoreState: StateCreator<StoreState> = (...a) => ({
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
  ...createEntityIndexSlice(...a),
  ...createDiagnosticsSlice(...a),
  ...createProjectDbSlice(...a),
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
  ...createNotificationsSlice(...a),
  ...createInboxSlice(...a),
  ...createSchedulesSlice(...a),
  ...createSkillComboSlice(...a),
  ...createUsageLimitsSlice(...a),
  ...createOverlaySlice(...a),
  ...createLaneSummariesSlice(...a),
  ...createAgentUsageSlice(...a),
  ...createMergeSlice(...a),
  ...createReviewSlice(...a),
  ...createGitGraphSlice(...a),
});
