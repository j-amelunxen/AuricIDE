'use client';

import { useEffect } from 'react';
import { CommandPalette } from '@/app/components/ide/CommandPalette';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { NewItemModal } from '@/app/components/explorer/NewItemModal';
import { RenameItemModal } from '@/app/components/explorer/RenameItemModal';
import { FileSearch } from '@/app/components/ide/FileSearch';
import { FileSelector } from '@/app/components/ide/FileSelector';
import { FindInFilesModal } from '@/app/components/ide/FindInFilesModal';
import { SettingsModal, type SettingsCategory } from '@/app/components/ide/SettingsModal';
import { SpawnAgentDialog } from '@/app/components/agents/SpawnAgentDialog';
import { useStore } from '@/lib/store';
import { ImportSpecDialog } from '@/app/components/agents/ImportSpecDialog';
import { GenerateDiagramDialog } from '@/app/components/agents/GenerateDiagramDialog';
import { AgentTerminalModal } from '@/app/components/agents/AgentTerminalModal';
import { LinkGraphModal } from '@/app/components/graph/LinkGraphModal';
import { BlueprintsGallery } from '@/app/components/blueprints/BlueprintsGallery';
import { PerformanceMonitor } from '@/app/components/dev/PerformanceMonitor';
import { type FileTreeNode } from '@/app/components/explorer/FileExplorer';
import { type ProjectFileInfo } from '@/lib/tauri/fs';
import { type AgentInfo, type AgentConfig } from '@/lib/tauri/agents';
import { type Command } from '@/lib/commands/registry';
import { type SpawnPreset } from '@/lib/agents/spawnDefaults';
import { VideoImportDialog } from '@/app/components/videoImport/VideoImportDialog';

interface IDEOverlaysProps {
  // Modals state
  spawnDialogOpen: boolean;
  setSpawnDialogOpen: (open: boolean) => void;
  initialAgentTask: string;
  setInitialAgentTask: (task: string) => void;
  spawnAgentTicketId: string | null;
  setSpawnAgentTicketId: (id: string | null) => void;
  spawnAgentGoalId: string | null;
  setSpawnAgentGoalId: (id: string | null) => void;
  spawnAgentRepoPath: string | null;
  setSpawnAgentRepoPath: (path: string | null) => void;
  spawnAgentPreset: SpawnPreset | null;
  setSpawnAgentPreset: (preset: SpawnPreset | null) => void;
  handleSpawnNewAgent: (config: AgentConfig) => Promise<void>;
  rootPath: string | null;
  recentProjects: { name: string; path: string }[];

  importSpecDialogOpen: boolean;
  setImportSpecDialogOpen: (open: boolean) => void;

  diagramDialogFolder: string | null;
  setDiagramDialogFolder: (folder: string | null) => void;

  fullscreenAgent: AgentInfo | null;
  setFullscreenAgent: (agent: AgentInfo | null) => void;
  handleSelectionSpawn: (selection: string) => void;

  linkGraphModalOpen: boolean;
  setLinkGraphModalOpen: (open: boolean) => void;
  handleFileSelect: (path: string) => void;

  settingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;
  settingsInitialCategory?: SettingsCategory;
  setSettingsInitialCategory: (category: SettingsCategory | undefined) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  commands: Command[];
  handleCommandExecute: (cmdId: string) => void;

  contextMenu: { x: number; y: number; node: FileTreeNode } | null;
  setContextMenu: (menu: { x: number; y: number; node: FileTreeNode } | null) => void;
  contextMenuOptions: ContextMenuOption[];

  newItemModal: { type: 'file' | 'folder'; parentDir: string } | null;
  setNewItemModal: (modal: { type: 'file' | 'folder'; parentDir: string } | null) => void;
  handleCreateNewItem: (name: string) => void;

  renameDialog: { path: string; oldName: string; isDirectory: boolean } | null;
  setRenameDialog: (dialog: { path: string; oldName: string; isDirectory: boolean } | null) => void;
  handleRenameConfirm: (name: string) => void;

  projectFiles: string[];
  fileSearchOpen: boolean;
  setFileSearchOpen: (open: boolean) => void;

  findInFilesOpen: boolean;
  setFindInFilesOpen: (open: boolean) => void;
  handleFindInFilesNavigate: (path: string, line: number) => void;

  projectFilesInfo: ProjectFileInfo[];
  fileSelectorOpen: boolean;
  setFileSelectorOpen: (open: boolean) => void;

  ticketCwd?: string;
}

export function IDEOverlays({
  spawnDialogOpen,
  setSpawnDialogOpen,
  initialAgentTask,
  setInitialAgentTask,
  spawnAgentTicketId,
  setSpawnAgentTicketId,
  spawnAgentGoalId,
  setSpawnAgentGoalId,
  spawnAgentRepoPath,
  setSpawnAgentRepoPath,
  spawnAgentPreset,
  setSpawnAgentPreset,
  handleSpawnNewAgent,
  rootPath,
  recentProjects,
  importSpecDialogOpen,
  setImportSpecDialogOpen,
  diagramDialogFolder,
  setDiagramDialogFolder,
  fullscreenAgent,
  setFullscreenAgent,
  handleSelectionSpawn,
  linkGraphModalOpen,
  setLinkGraphModalOpen,
  handleFileSelect,
  settingsModalOpen,
  setSettingsModalOpen,
  settingsInitialCategory,
  setSettingsInitialCategory,
  commandPaletteOpen,
  setCommandPaletteOpen,
  commands,
  handleCommandExecute,
  contextMenu,
  setContextMenu,
  contextMenuOptions,
  newItemModal,
  setNewItemModal,
  handleCreateNewItem,
  renameDialog,
  setRenameDialog,
  handleRenameConfirm,
  projectFiles,
  fileSearchOpen,
  setFileSearchOpen,
  findInFilesOpen,
  setFindInFilesOpen,
  handleFindInFilesNavigate,
  projectFilesInfo,
  fileSelectorOpen,
  setFileSelectorOpen,
  ticketCwd,
}: IDEOverlaysProps) {
  const goalsDraft = useStore((s) => s.goalsDraft);
  const activeAgents = useStore((s) => s.agents);
  const recentCommandIds = useStore((s) => s.recentCommandIds);
  const promptHistory = useStore((s) => s.promptHistory);
  const loadPromptHistory = useStore((s) => s.loadPromptHistory);
  const killRunningAgent = useStore((s) => s.killRunningAgent);
  const dismissFinishedAgent = useStore((s) => s.dismissFinishedAgent);

  // One source of truth: the repo the dialog targets and the repo whose prompt
  // history it recalls have to be the same path. Quick Access and ticket
  // launches both aim at a repo that is not the open project, and offering
  // prompts from a project the agent will never run in is worse than none.
  const spawnRepoPath = spawnAgentRepoPath || ticketCwd || rootPath || '';

  // Refresh on every open: the dialog is reachable from many entry points and
  // an agent may have been started from any of them since the last look. No
  // truthiness guard on the path — loadPromptHistory clears the list for an
  // empty one, which is exactly right on the welcome screen.
  useEffect(() => {
    if (!spawnDialogOpen) return;
    void loadPromptHistory(spawnRepoPath);
  }, [spawnDialogOpen, spawnRepoPath, loadPromptHistory]);

  return (
    <>
      <SpawnAgentDialog
        isOpen={spawnDialogOpen}
        onClose={() => {
          setSpawnDialogOpen(false);
          setInitialAgentTask('');
          setSpawnAgentTicketId(null);
          setSpawnAgentGoalId(null);
          setSpawnAgentRepoPath(null);
          setSpawnAgentPreset(null);
        }}
        onSpawn={handleSpawnNewAgent}
        initialTask={initialAgentTask}
        spawnedByTicketId={spawnAgentTicketId}
        initialRepoPath={spawnRepoPath}
        presetDefaults={spawnAgentPreset}
        recentPaths={recentProjects.map((p) => p.path)}
        goals={goalsDraft}
        initialGoalId={spawnAgentGoalId}
        promptHistory={promptHistory}
      />
      <ImportSpecDialog
        isOpen={importSpecDialogOpen}
        onClose={() => setImportSpecDialogOpen(false)}
        onSpawn={handleSpawnNewAgent}
        workingDirectory={rootPath || ''}
      />
      <VideoImportDialog />
      <GenerateDiagramDialog
        isOpen={diagramDialogFolder !== null}
        onClose={() => setDiagramDialogFolder(null)}
        onGenerate={handleSpawnNewAgent}
        folderPath={diagramDialogFolder ?? ''}
      />
      <AgentTerminalModal
        agent={fullscreenAgent}
        agents={activeAgents}
        onSwitchAgent={setFullscreenAgent}
        onClose={() => setFullscreenAgent(null)}
        onSelectionSpawn={handleSelectionSpawn}
        onKill={killRunningAgent}
        onDismiss={dismissFinishedAgent}
      />
      <LinkGraphModal
        isOpen={linkGraphModalOpen}
        onClose={() => setLinkGraphModalOpen(false)}
        onFileSelect={handleFileSelect}
      />
      <BlueprintsGallery />
      <SettingsModal
        isOpen={settingsModalOpen}
        initialCategory={settingsInitialCategory}
        onClose={() => {
          setSettingsModalOpen(false);
          setSettingsInitialCategory(undefined);
        }}
      />
      {commandPaletteOpen && (
        <CommandPalette
          commands={commands}
          isOpen
          recentIds={recentCommandIds}
          hasProject={Boolean(rootPath)}
          onClose={() => setCommandPaletteOpen(false)}
          onExecute={handleCommandExecute}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={contextMenuOptions}
          onClose={() => setContextMenu(null)}
        />
      )}
      {newItemModal && (
        <NewItemModal
          type={newItemModal.type}
          onConfirm={handleCreateNewItem}
          onCancel={() => setNewItemModal(null)}
        />
      )}
      {renameDialog && (
        <RenameItemModal
          oldName={renameDialog.oldName}
          isDirectory={renameDialog.isDirectory}
          onConfirm={handleRenameConfirm}
          onCancel={() => setRenameDialog(null)}
        />
      )}
      <FileSearch
        files={projectFiles}
        isOpen={fileSearchOpen}
        onClose={() => setFileSearchOpen(false)}
        onSelect={(path) => {
          handleFileSelect(path);
          setFileSearchOpen(false);
        }}
        rootPath={rootPath}
      />
      <FileSelector
        files={projectFilesInfo}
        isOpen={fileSelectorOpen}
        onClose={() => setFileSelectorOpen(false)}
        rootPath={rootPath}
      />
      <FindInFilesModal
        isOpen={findInFilesOpen}
        onClose={() => setFindInFilesOpen(false)}
        onNavigate={handleFindInFilesNavigate}
        rootPath={rootPath}
      />
      <PerformanceMonitor />
    </>
  );
}
