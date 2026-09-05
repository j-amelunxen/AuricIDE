'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { SpawnAgentDialogProps } from './spawnDialog/types';
import { useSpawnAgentDialog } from './spawnDialog/useSpawnAgentDialog';
import { WorkingDirectorySection } from './spawnDialog/WorkingDirectorySection';
import { TaskDescriptionSection } from './spawnDialog/TaskDescriptionSection';
import { ProviderModelSection } from './spawnDialog/ProviderModelSection';
import { WorktreeConfigSection } from './spawnDialog/WorktreeConfigSection';

export type { SpawnAgentDialogProps };

export function SpawnAgentDialog(props: SpawnAgentDialogProps) {
  if (!props.isOpen) return null;
  return <SpawnAgentDialogPanel {...props} />;
}

function SpawnAgentDialogPanel(props: SpawnAgentDialogProps) {
  const { onClose } = props;
  const {
    dialogRef,
    confirmDialog,
    repoPath,
    syncTypedPath,
    handleBrowse,
    recentPaths,
    sortedQuickAccess,
    selectedPaths,
    allPinnedSelected,
    toggleSelectAll,
    toggleQuickAccess,
    taskRef,
    task,
    handleTaskChange,
    handleTaskKeyDown,
    discovered,
    attachments,
    removeAttachment,
    promptHistory,
    goals,
    goalId,
    setGoalId,
    providers,
    selectedProviderId,
    setSelectedProviderId,
    noProviderPermitted,
    currentProvider,
    model,
    setModel,
    permissionMode,
    setPermissionMode,
    headless,
    setHeadless,
    useWorktree,
    handleUseWorktreeChange,
    showWorktreePicker,
    worktreeSources,
    worktreeRepoPath,
    handleWorktreeRepoChange,
    worktreeError,
    instruction,
    fanoutCount,
    handleDeploy,
    isDropTarget,
    handleHtml5DragOver,
    handleHtml5DragLeave,
    handleHtml5Drop,
  } = useSpawnAgentDialog(props);

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-tool-nested)] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter deploys from anywhere in the dialog — a plain Enter
          // stays available for writing a multi-line instruction.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleDeploy();
          }
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="spawn-agent-title"
          className="glass-card relative w-full max-w-md overflow-visible rounded-xl border border-white/10 bg-surface p-6 shadow-2xl animate-in fade-in zoom-in duration-200"
          onClick={(e) => e.stopPropagation()}
          onDragOver={handleHtml5DragOver}
          onDragLeave={handleHtml5DragLeave}
          onDrop={handleHtml5Drop}
        >
          {isDropTarget && (
            <div
              data-testid="spawn-drop-overlay"
              className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center rounded-xl border-2 border-primary/60 bg-primary/10"
            >
              <span className="rounded-full bg-black/60 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                Drop to attach
              </span>
            </div>
          )}
          <div className="mb-6 flex items-center gap-2">
            <AuricIcon name="rocket_launch" className="text-primary" />
            <h2
              id="spawn-agent-title"
              className="text-sm font-bold tracking-tight text-foreground uppercase"
            >
              Start agent
            </h2>
          </div>

          <div className="flex flex-col gap-5">
            <WorkingDirectorySection
              repoPath={repoPath}
              onRepoPathChange={syncTypedPath}
              onBrowse={handleBrowse}
              recentPaths={recentPaths}
              sortedQuickAccess={sortedQuickAccess}
              selectedPaths={selectedPaths}
              allPinnedSelected={allPinnedSelected}
              onToggleSelectAll={toggleSelectAll}
              onToggleQuickAccess={toggleQuickAccess}
            />

            <TaskDescriptionSection
              taskRef={taskRef}
              task={task}
              onTaskChange={handleTaskChange}
              onKeyDown={handleTaskKeyDown}
              discovered={discovered}
              attachments={attachments}
              onRemoveAttachment={removeAttachment}
              promptHistory={promptHistory}
            />

            <ProviderModelSection
              goals={goals}
              goalId={goalId}
              onGoalIdChange={setGoalId}
              providers={providers}
              selectedProviderId={selectedProviderId}
              onProviderChange={setSelectedProviderId}
              noProviderPermitted={noProviderPermitted}
              currentProvider={currentProvider}
              model={model}
              onModelChange={setModel}
              permissionMode={permissionMode}
              onPermissionModeChange={setPermissionMode}
              headless={headless}
              onHeadlessChange={setHeadless}
            />

            <WorktreeConfigSection
              repoPath={repoPath}
              useWorktree={useWorktree}
              onUseWorktreeChange={handleUseWorktreeChange}
              showWorktreePicker={showWorktreePicker}
              worktreeSources={worktreeSources}
              worktreeRepoPath={worktreeRepoPath}
              onWorktreeRepoChange={handleWorktreeRepoChange}
              worktreeError={worktreeError}
            />

            <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-foreground-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeploy}
                disabled={
                  !instruction ||
                  noProviderPermitted ||
                  (useWorktree && (!!worktreeError || (showWorktreePicker && !worktreeRepoPath)))
                }
                className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-xs font-bold text-white shadow-[0_0_15px_rgba(var(--primary-rgb),0.3)] hover:brightness-110 transition-all disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
              >
                {fanoutCount > 1 ? `Start ${fanoutCount} agents` : 'Start Agent'}
                <span aria-hidden="true" className="text-[10px] font-medium opacity-70">
                  ⌘↵
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {confirmDialog}
    </>
  );
}
