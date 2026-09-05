'use client';

import { useState, useCallback } from 'react';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useTreeRefresh } from './ide/useTreeRefresh';
import { useFileTreeSelection } from './ide/useFileTreeSelection';
import { useEditorAndScratchHandlers } from './ide/useEditorAndScratchHandlers';
import { useFileMutations } from './ide/useFileMutations';
import { useGitActionHandlers } from './ide/useGitActionHandlers';
import { useCanvasAndTicketHandlers } from './ide/useCanvasAndTicketHandlers';
import {
  useAgentAndCommandHandlers,
  CONTEXT_BOUND_COMMANDS,
} from './ide/useAgentAndCommandHandlers';
import { useContextMenuOptions } from './ide/useContextMenuOptions';
import { useStore } from '@/lib/store';
import type { useIDEState } from './useIDEState';

export { CONTEXT_BOUND_COMMANDS };

/**
 * Facade hook coordinating domain-specific IDE handler hooks.
 * Delegates file, editor, git, canvas, and agent operations to focused sub-hooks.
 */
export function useIDEHandlers(state: ReturnType<typeof useIDEState>) {
  const [clipboard, setClipboard] = useState<{ path: string; isDirectory: boolean } | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  // 1. Tree refresh & project lifecycle
  const treeRefresh = useTreeRefresh(state, confirm);

  // 2. File tree selection & navigation
  const selection = useFileTreeSelection(state, treeRefresh.leaveWorkPlace);
  const { handleFileSelect } = selection;

  // 3. Editor, autosave & scratchpads
  const editorAndScratch = useEditorAndScratchHandlers(state, handleFileSelect);
  const { loadTabContent } = editorAndScratch;

  // Find-in-files navigation connects selection and tab content loading
  const handleFindInFilesNavigate = useCallback(
    async (path: string, line: number) => {
      if (useStore.getState().activeTabId !== path) {
        await handleFileSelect(path);
        await loadTabContent(path);
      }
      state.setScrollToLine(line);
    },
    [state, handleFileSelect, loadTabContent]
  );

  // 4. File mutations, creation, rename, move, delete
  const fileMutations = useFileMutations(
    state,
    clipboard,
    treeRefresh.handleRefresh,
    handleFileSelect,
    confirm
  );

  // 5. Git actions, commit, push, history, diff
  const gitActions = useGitActionHandlers(state, treeRefresh.handleRefresh);

  // 6. Canvas, mindmap, obsidian canvas & ticket creation
  const canvasAndTicket = useCanvasAndTicketHandlers(state, handleFileSelect);

  // 7. Agent deployment, terminals, project switching & commands
  const agentAndCommands = useAgentAndCommandHandlers({
    state,
    handleRefresh: treeRefresh.handleRefresh,
    leaveWorkPlace: treeRefresh.leaveWorkPlace,
    handleNewFile: fileMutations.handleNewFile,
    handleNewDiagram: fileMutations.handleNewDiagram,
    handleSave: editorAndScratch.handleSave,
    handleCommit: gitActions.handleCommit,
    handleNewScratch: editorAndScratch.handleNewScratch,
    showFileHistory: gitActions.showFileHistory,
  });

  // 8. Context menu options
  const contextMenu = useContextMenuOptions({
    state,
    clipboard,
    setClipboard,
    handleCopyPath: fileMutations.handleCopyPath,
    handleCopyPaths: fileMutations.handleCopyPaths,
    handleDeleteSelection: fileMutations.handleDeleteSelection,
    handleRenameRequest: fileMutations.handleRenameRequest,
    handlePaste: fileMutations.handlePaste,
    handleOpenTerminalHere: agentAndCommands.handleOpenTerminalHere,
    handleNewDiagram: fileMutations.handleNewDiagram,
    handleCreateTicketFromMarkdown: canvasAndTicket.handleCreateTicketFromMarkdown,
    handleAddToGitignore: fileMutations.handleAddToGitignore,
    handleIgnoreGitRepo: fileMutations.handleIgnoreGitRepo,
  });

  return {
    clipboard,
    setClipboard,
    ...treeRefresh,
    ...selection,
    handleFindInFilesNavigate,
    ...fileMutations,
    ...editorAndScratch,
    ...gitActions,
    ...canvasAndTicket,
    ...agentAndCommands,
    ...contextMenu,
    confirmDialog,
  };
}
