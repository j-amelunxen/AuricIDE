'use client';

import { CommandPalette } from '@/app/components/ide/CommandPalette';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { NewItemModal } from '@/app/components/explorer/NewItemModal';
import { FileSearch } from '@/app/components/ide/FileSearch';
import { FileSelector } from '@/app/components/ide/FileSelector';
import { SettingsModal } from '@/app/components/ide/SettingsModal';
import { ProjectManagerModal } from '@/app/components/pm/ProjectManagerModal';
import { SpawnAgentDialog } from '@/app/components/agents/SpawnAgentDialog';
import { ImportSpecDialog } from '@/app/components/agents/ImportSpecDialog';
import { GenerateDiagramDialog } from '@/app/components/agents/GenerateDiagramDialog';
import { AgentTerminalModal } from '@/app/components/agents/AgentTerminalModal';
import { LinkGraphModal } from '@/app/components/graph/LinkGraphModal';
import { PerformanceMonitor } from '@/app/components/dev/PerformanceMonitor';
import { type FileTreeNode } from '@/app/components/explorer/FileExplorer';
import { type ProjectFileInfo } from '@/lib/tauri/fs';
import { type AgentInfo, type AgentConfig } from '@/lib/tauri/agents';
import { type Command } from '@/lib/commands/registry';

interface IDEOverlaysProps {
  // Modals state
  spawnDialogOpen: boolean;
  setSpawnDialogOpen: (open: boolean) => void;
  initialAgentTask: string;
  setInitialAgentTask: (task: string) => void;
  spawnAgentTicketId: string | null;
  setSpawnAgentTicketId: (id: string | null) => void;
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

  projectFiles: string[];
  fileSearchOpen: boolean;
  setFileSearchOpen: (open: boolean) => void;

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
  projectFiles,
  fileSearchOpen,
  setFileSearchOpen,
  projectFilesInfo,
  fileSelectorOpen,
  setFileSelectorOpen,
  ticketCwd,
}: IDEOverlaysProps) {
  return (
    <>
      <SpawnAgentDialog
        isOpen={spawnDialogOpen}
        onClose={() => {
          setSpawnDialogOpen(false);
          setInitialAgentTask('');
          setSpawnAgentTicketId(null);
        }}
        onSpawn={handleSpawnNewAgent}
        initialTask={initialAgentTask}
        spawnedByTicketId={spawnAgentTicketId}
        initialRepoPath={ticketCwd || rootPath || ''}
        recentPaths={recentProjects.map((p) => p.path)}
      />
      <ImportSpecDialog
        isOpen={importSpecDialogOpen}
        onClose={() => setImportSpecDialogOpen(false)}
        onSpawn={handleSpawnNewAgent}
        workingDirectory={rootPath || ''}
      />
      <GenerateDiagramDialog
        isOpen={diagramDialogFolder !== null}
        onClose={() => setDiagramDialogFolder(null)}
        onGenerate={handleSpawnNewAgent}
        folderPath={diagramDialogFolder ?? ''}
      />
      <AgentTerminalModal
        agent={fullscreenAgent}
        onClose={() => setFullscreenAgent(null)}
        onSelectionSpawn={handleSelectionSpawn}
      />
      <LinkGraphModal
        isOpen={linkGraphModalOpen}
        onClose={() => setLinkGraphModalOpen(false)}
        onFileSelect={handleFileSelect}
      />
      <ProjectManagerModal />
      <SettingsModal isOpen={settingsModalOpen} onClose={() => setSettingsModalOpen(false)} />
      {commandPaletteOpen && (
        <CommandPalette
          commands={commands}
          isOpen
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
      <PerformanceMonitor />
    </>
  );
}
