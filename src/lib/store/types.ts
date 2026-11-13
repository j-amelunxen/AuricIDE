import type { StoreApi } from 'zustand';
import type { AgentSlice } from './agentSlice';
import type { AgentUsageSlice } from './agentUsageSlice';
import type { CanvasSlice } from './canvasSlice';
import type { FileTreeSlice } from './fileTreeSlice';
import type { GitSlice } from './gitSlice';
import type { RecentProjectsSlice } from './recentProjectsSlice';
import type { StarredProjectsSlice } from './starredProjectsSlice';
import type { TabsSlice } from './tabsSlice';
import type { UISlice } from './uiSlice';
import type { WikiLinkSlice } from './wikiLinkSlice';
import type { SlashCommandSlice } from './slashCommandSlice';
import type { EntityIndexSlice } from './entityIndexSlice';
import type { DiagnosticsSlice } from './diagnosticsSlice';
import type { ProjectDbSlice } from './projectDbSlice';
import type { PmSlice } from './pmSlice';
import type { QASlice } from './qaSlice';
import type { BlueprintsSlice } from './blueprintsSlice';
import type { ObsidianCanvasSlice } from './obsidianCanvasSlice';
import type { RequirementsSlice } from './requirementsSlice';
import type { GoalsSlice } from './goalsSlice';
import type { ConductorSlice } from './conductorSlice';
import type { ToastSlice } from './toastSlice';
import type { ExcalidrawSlice } from './excalidrawSlice';
import type { CommandUsageSlice } from './commandUsageSlice';
import type { ScratchSlice } from './scratchSlice';
import type { NotificationsSlice } from './notificationsSlice';
import type { InboxSlice } from './inboxSlice';
import type { SchedulesSlice } from './schedulesSlice';
import type { SkillComboSlice } from './skillComboSlice';
import type { UsageLimitsSlice } from './usageLimitsSlice';
import type { OverlaySlice } from '@/lib/overlays/overlaySlice';
import type { LaneSummariesSlice } from './laneSummariesSlice';
import type { MergeSlice } from './mergeSlice';
import type { ReviewSlice } from './reviewSlice';
import type { GitGraphSlice } from './gitGraphSlice';

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
  EntityIndexSlice &
  DiagnosticsSlice &
  ProjectDbSlice &
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
  ScratchSlice &
  NotificationsSlice &
  InboxSlice &
  SchedulesSlice &
  SkillComboSlice &
  UsageLimitsSlice &
  OverlaySlice &
  LaneSummariesSlice &
  AgentUsageSlice &
  MergeSlice &
  ReviewSlice &
  GitGraphSlice;

export type StoreGet = StoreApi<StoreState>['getState'];
export type StoreSet = StoreApi<StoreState>['setState'];
