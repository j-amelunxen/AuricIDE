'use client';

import { memo } from 'react';
import { useStore } from '@/lib/store';
import { useAttentionTitle } from '@/lib/hooks/useAttentionTitle';
import { AgentsPanel, type AgentsPanelProps } from '../agents/AgentsPanel';
import { TerminalPanel, type ExtraTerminal } from '../terminal/TerminalPanel';
import { StatusBar, type StatusBarProps } from './StatusBar';

/*
 * The panels below display state that changes many times a second — agent
 * activity, the cursor. Selected in the page, every one of those writes
 * re-rendered the whole IDE. Each wrapper selects its own hot fields, so a
 * write reaches exactly the panel that shows it. Everything the page still
 * passes in is a stable callback or a rarely changing value, so the `memo`
 * holds while the page re-renders for other reasons.
 */

/**
 * A null leaf that owns the window-title/dock-badge mirroring. The hook ticks
 * on useNow — mounting it here instead of in Home keeps the 1 Hz timer off
 * the page root, which would otherwise re-render the whole IDE every second.
 */
export const AttentionTitle = memo(function AttentionTitle(): null {
  const agents = useStore((s) => s.agents);
  const reviewedAgentIds = useStore((s) => s.reviewedAgentIds);
  useAttentionTitle(agents, reviewedAgentIds);
  return null;
});

type PagePassedAgentsPanelProps = Pick<
  AgentsPanelProps,
  'onSpawn' | 'onKill' | 'onSelectAgent' | 'onImageDrop' | 'onCollapse' | 'onResumeInterrupted'
>;

export const ConnectedAgentsPanel = memo(function ConnectedAgentsPanel(
  props: PagePassedAgentsPanelProps
) {
  const agents = useStore((s) => s.agents);
  const interruptedAgents = useStore((s) => s.interruptedAgents);
  const minimizedAgentIds = useStore((s) => s.minimizedAgentIds);
  const collapsedAgentRepos = useStore((s) => s.collapsedAgentRepos);
  const agentColors = useStore((s) => s.agentColors);
  const reviewedAgentIds = useStore((s) => s.reviewedAgentIds);
  const killAgentsForRepoPath = useStore((s) => s.killAgentsForRepoPath);
  const openAgentConsole = useStore((s) => s.openAgentConsole);
  const discardInterruptedAgent = useStore((s) => s.discardInterruptedAgent);
  const setAgentMinimized = useStore((s) => s.setAgentMinimized);
  const renameRunningAgent = useStore((s) => s.renameRunningAgent);
  const dismissFinishedAgent = useStore((s) => s.dismissFinishedAgent);
  const toggleAgentRepoCollapsed = useStore((s) => s.toggleAgentRepoCollapsed);
  const setAgentColor = useStore((s) => s.setAgentColor);
  const retryFailedAgent = useStore((s) => s.retryFailedAgent);
  return (
    <AgentsPanel
      {...props}
      agents={agents}
      interruptedAgents={interruptedAgents}
      onKillRepo={killAgentsForRepoPath}
      onOpenConsole={openAgentConsole}
      onDiscardInterrupted={discardInterruptedAgent}
      minimizedAgentIds={minimizedAgentIds}
      onToggleMinimize={setAgentMinimized}
      onRename={renameRunningAgent}
      onDismissFinished={dismissFinishedAgent}
      collapsedRepos={collapsedAgentRepos}
      onToggleRepoCollapsed={toggleAgentRepoCollapsed}
      agentColors={agentColors}
      onSetColor={setAgentColor}
      reviewedAgentIds={reviewedAgentIds}
      onRetryFailed={retryFailedAgent}
    />
  );
});

export const ConnectedTerminalPanel = memo(function ConnectedTerminalPanel(props: {
  onSelectAgent: (agentId: string | null) => void;
  rootPath: string | null;
  extraTerminals: ExtraTerminal[];
  onCloseTerminal: (id: string) => void;
}) {
  const agents = useStore((s) => s.agents);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  return <TerminalPanel {...props} agents={agents} selectedAgentId={selectedAgentId} />;
});

export const ConnectedStatusBar = memo(function ConnectedStatusBar(
  props: Omit<StatusBarProps, 'cursorPos'>
) {
  const cursorPos = useStore((s) => s.cursorPos);
  return <StatusBar {...props} cursorPos={cursorPos} />;
});
