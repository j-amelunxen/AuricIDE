import { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '@/lib/tauri/providers';
import { type ProjectFileInfo } from '@/lib/tauri/fs';
import { type FileTreeNode } from '@/app/components/explorer/FileExplorer';
import { type MindmapData } from '@/lib/mindmap/mindmapParser';
import { type AgentInfo } from '@/lib/tauri/agents';
import { type BottomTab } from '@/app/components/ide/BottomPanelTabs';
import { type ExtraTerminal } from '@/app/components/terminal/TerminalPanel';

export function useIDEState() {
  const [activeActivity, setActiveActivity] = useState('explorer');
  const [editorContent, setEditorContent] = useState('');
  const [imageData, setImageData] = useState<string | null>(null);
  const [mindmapData, setMindmapData] = useState<MindmapData | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [bottomCollapsed, setBottomCollapsed] = useState(true);
  const [fullscreenAgent, setFullscreenAgent] = useState<AgentInfo | null>(null);
  const [scrollToLine, setScrollToLine] = useState<number | undefined>(undefined);
  const [linkGraphModalOpen, setLinkGraphModalOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('terminal');
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  // Store Selectors
  const rootPath = useStore((s) => s.rootPath);
  const setRootPath = useStore((s) => s.setRootPath);
  const fileTree = useStore((s) => s.fileTree);
  const setFileTree = useStore((s) => s.setFileTree);
  const setDirectoryChildren = useStore((s) => s.setDirectoryChildren);
  const selectedPath = useStore((s) => s.selectedPath);
  const selectFile = useStore((s) => s.selectFile);
  const toggleExpand = useStore((s) => s.toggleExpand);
  const closeProject = useStore((s) => s.closeProject);
  const openTabs = useStore((s) => s.openTabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const openTab = useStore((s) => s.openTab);
  const closeTab = useStore((s) => s.closeTab);
  const closeOtherTabs = useStore((s) => s.closeOtherTabs);
  const closeAllTabs = useStore((s) => s.closeAllTabs);
  const closeTabsToRight = useStore((s) => s.closeTabsToRight);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const markDirty = useStore((s) => s.markDirty);
  const branchInfo = useStore((s) => s.branchInfo);
  const fileStatuses = useStore((s) => s.fileStatuses);
  const commitMessage = useStore((s) => s.commitMessage);
  const isCommitting = useStore((s) => s.isCommitting);
  const setCommitMessage = useStore((s) => s.setCommitMessage);
  const stageFile = useStore((s) => s.stageFile);
  const unstageFile = useStore((s) => s.unstageFile);
  const commitChanges = useStore((s) => s.commit);
  const agents = useStore((s) => s.agents);
  const spawnNewAgent = useStore((s) => s.spawnNewAgent);
  const killRunningAgent = useStore((s) => s.killRunningAgent);
  const updateAgentStatus = useStore((s) => s.updateAgentStatus);
  const appendAgentLog = useStore((s) => s.appendAgentLog);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const selectAgent = useStore((s) => s.selectAgent);
  const killAgentsForRepoPath = useStore((s) => s.killAgentsForRepoPath);
  const canvasNodes = useStore((s) => s.canvasNodes);
  const canvasEdges = useStore((s) => s.canvasEdges);
  const setCanvasData = useStore((s) => s.setCanvasData);
  const selectNode = useStore((s) => s.selectNode);
  const addTerminalLog = useStore((s) => s.addTerminalLog);
  const clearTerminalLogs = useStore((s) => s.clearTerminalLogs);
  const cursorPos = useStore((s) => s.cursorPos);
  const setCursorPos = useStore((s) => s.setCursorPos);
  const commandPaletteOpen = useStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const fileSearchOpen = useStore((s) => s.fileSearchOpen);
  const setFileSearchOpen = useStore((s) => s.setFileSearchOpen);
  const fileSelectorOpen = useStore((s) => s.fileSelectorOpen);
  const setFileSelectorOpen = useStore((s) => s.setFileSelectorOpen);
  const spawnDialogOpen = useStore((s) => s.spawnDialogOpen);
  const setSpawnDialogOpen = useStore((s) => s.setSpawnDialogOpen);
  const importSpecDialogOpen = useStore((s) => s.importSpecDialogOpen);
  const setImportSpecDialogOpen = useStore((s) => s.setImportSpecDialogOpen);
  const initialAgentTask = useStore((s) => s.initialAgentTask);
  const setInitialAgentTask = useStore((s) => s.setInitialAgentTask);
  const cliConnected = useStore((s) => s.cliConnected);
  const setCliConnected = useStore((s) => s.setCliConnected);
  const llmConfigured = useStore((s) => s.llmConfigured);
  const setLlmConfigured = useStore((s) => s.setLlmConfigured);
  const agentSettings = useStore((s) => s.agentSettings);
  const updateAgentSettings = useStore((s) => s.updateAgentSettings);
  const recentProjects = useStore((s) => s.recentProjects);
  const addRecentProject = useStore((s) => s.addRecentProject);
  const removeRecentProject = useStore((s) => s.removeRecentProject);
  const loadRecentProjects = useStore((s) => s.loadRecentProjects);
  const loadCustomSlashCommands = useStore((s) => s.loadCustomSlashCommands);
  const initProjectDb = useStore((s) => s.initProjectDb);
  const closeProjectDb = useStore((s) => s.closeProjectDb);
  const setAllFiles = useStore((s) => s.setAllFiles);
  const updateFileInIndex = useStore((s) => s.updateFileInIndex);
  const bulkUpdateFilesInIndex = useStore((s) => s.bulkUpdateFilesInIndex);
  const clearEntityIndex = useStore((s) => s.clearEntityIndex);
  const clearHeadingIndex = useStore((s) => s.clearHeadingIndex);
  const clearLinkIndex = useStore((s) => s.clearLinkIndex);
  const diagnostics = useStore((s) => s.diagnostics);
  const getDiagnosticCounts = useStore((s) => s.getDiagnosticCounts);
  const setProblemsPanelOpen = useStore((s) => s.setProblemsPanelOpen);
  const setPmModalOpen = useStore((s) => s.setPmModalOpen);
  const loadPmData = useStore((s) => s.loadPmData);
  const pmDraftTickets = useStore((s) => s.pmDraftTickets);
  const providers = useStore((s) => s.providers);
  const setProviders = useStore((s) => s.setProviders);
  const setSpawnAgentTicketId = useStore((s) => s.setSpawnAgentTicketId);
  const spawnAgentTicketId = useStore((s) => s.spawnAgentTicketId);
  const refreshGitStatus = useStore((s) => s.refreshGitStatus);

  const [defaultProvider, setDefaultProvider] = useState<ProviderInfo>(FALLBACK_CRUSH_PROVIDER);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [projectFilesInfo, setProjectFilesInfo] = useState<ProjectFileInfo[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileTreeNode;
  } | null>(null);
  const [newItemModal, setNewItemModal] = useState<{
    type: 'file' | 'folder';
    parentDir: string;
  } | null>(null);
  const [extraTerminals, setExtraTerminals] = useState<ExtraTerminal[]>([]);
  const [diagramDialogFolder, setDiagramDialogFolder] = useState<string | null>(null);

  const ticketCwd = useMemo(
    () =>
      spawnAgentTicketId
        ? pmDraftTickets.find((t) => t.id === spawnAgentTicketId)?.workingDirectory
        : undefined,
    [spawnAgentTicketId, pmDraftTickets]
  );

  return {
    activeActivity,
    setActiveActivity,
    editorContent,
    setEditorContent,
    imageData,
    setImageData,
    mindmapData,
    setMindmapData,
    diffContent,
    setDiffContent,
    bottomCollapsed,
    setBottomCollapsed,
    fullscreenAgent,
    setFullscreenAgent,
    scrollToLine,
    setScrollToLine,
    linkGraphModalOpen,
    setLinkGraphModalOpen,
    bottomTab,
    setBottomTab,
    settingsModalOpen,
    setSettingsModalOpen,
    rootPath,
    setRootPath,
    fileTree,
    setFileTree,
    setDirectoryChildren,
    selectedPath,
    selectFile,
    toggleExpand,
    closeProject,
    openTabs,
    activeTabId,
    openTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    closeTabsToRight,
    setActiveTab,
    markDirty,
    branchInfo,
    fileStatuses,
    commitMessage,
    isCommitting,
    setCommitMessage,
    stageFile,
    unstageFile,
    commitChanges,
    agents,
    spawnNewAgent,
    killRunningAgent,
    updateAgentStatus,
    appendAgentLog,
    selectedAgentId,
    selectAgent,
    killAgentsForRepoPath,
    canvasNodes,
    canvasEdges,
    setCanvasData,
    selectNode,
    addTerminalLog,
    clearTerminalLogs,
    cursorPos,
    setCursorPos,
    commandPaletteOpen,
    setCommandPaletteOpen,
    fileSearchOpen,
    setFileSearchOpen,
    fileSelectorOpen,
    setFileSelectorOpen,
    spawnDialogOpen,
    setSpawnDialogOpen,
    importSpecDialogOpen,
    setImportSpecDialogOpen,
    initialAgentTask,
    setInitialAgentTask,
    cliConnected,
    setCliConnected,
    llmConfigured,
    setLlmConfigured,
    agentSettings,
    updateAgentSettings,
    recentProjects,
    addRecentProject,
    removeRecentProject,
    loadRecentProjects,
    loadCustomSlashCommands,
    initProjectDb,
    closeProjectDb,
    setAllFiles,
    updateFileInIndex,
    bulkUpdateFilesInIndex,
    clearEntityIndex,
    clearHeadingIndex,
    clearLinkIndex,
    diagnostics,
    getDiagnosticCounts,
    setProblemsPanelOpen,
    setPmModalOpen,
    loadPmData,
    pmDraftTickets,
    providers,
    setProviders,
    setSpawnAgentTicketId,
    spawnAgentTicketId,
    refreshGitStatus,
    defaultProvider,
    setDefaultProvider,
    projectFiles,
    setProjectFiles,
    projectFilesInfo,
    setProjectFilesInfo,
    contextMenu,
    setContextMenu,
    newItemModal,
    setNewItemModal,
    extraTerminals,
    setExtraTerminals,
    diagramDialogFolder,
    setDiagramDialogFolder,
    ticketCwd,
  };
}
