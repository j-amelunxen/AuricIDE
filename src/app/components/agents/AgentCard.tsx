'use client';

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import { isAgentIdling, isAgentLive } from '@/lib/agents/liveness';
import { formatAgentDuration } from '@/lib/agents/duration';
import { agentState } from '@/lib/agents/state';
import { agentColorHex, agentColorLabel, type AgentColor } from '@/lib/agents/colors';
import { stripAnsi } from '@/lib/terminal/ansi';
import { scrollBehavior } from '@/lib/motion';
import { agentDisplayIdentity } from '@/lib/agents/displayName';
import { LOG_PREVIEW_CHUNKS } from './card/cardConstants';
import { AgentCardHeader } from './card/AgentCardHeader';
import { AgentCardStatusBody } from './card/AgentCardStatusBody';
import { AgentCardTerminalBody } from './card/AgentCardTerminalBody';

export { AgentCardHeader } from './card/AgentCardHeader';
export { AgentCardStatusBody } from './card/AgentCardStatusBody';
export { AgentCardTerminalBody } from './card/AgentCardTerminalBody';

const EMPTY_LOGS: string[] = [];

export interface AgentCardProps {
  agent: AgentInfo;
  onKill: (id: string) => void;
  onSelect?: (id: string) => void;
  /** Fold this agent down to a parked one-liner. Omit to hide the control. */
  onMinimize?: (id: string) => void;
  /** Give the agent a human-chosen name. Omit to hide the control. */
  onRename?: (id: string, name: string) => void;
  /** Marker colour the user put on this agent, for grouping and flagging. */
  color?: AgentColor;
  /** Right-click on the card — the panel turns this into the colour menu. */
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
}

export function AgentCard({
  agent,
  onKill,
  onSelect,
  onMinimize,
  onRename,
  color,
  onContextMenu,
}: AgentCardProps) {
  const [viewMode, setViewMode] = useState<'status' | 'terminal'>('status');
  const [isRenaming, setIsRenaming] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const now = useNow();
  const isRunning = agent.status === 'running';
  const isLive = isAgentLive(agent, now);
  const isIdling = isAgentIdling(agent, now);
  const state = agentState(agent, now);
  const markerHex = agentColorHex(color);
  const markerLabel = agentColorLabel(color);
  const { displayName, taskSummary } = agentDisplayIdentity(agent.name, agent.currentTask);
  const comboRun = useStore((s) => s.comboRuns.find((run) => run.currentAgentId === agent.id));
  const cancelSkillCombo = useStore((s) => s.cancelSkillCombo);

  const comboNextStep = comboRun ? comboRun.steps[comboRun.currentIndex + 1] : undefined;
  const comboNextName = comboNextStep
    ? comboNextStep.label || `step ${comboRun!.currentIndex + 2}`
    : null;
  const endLabel = !comboRun
    ? 'Terminate Agent'
    : comboNextName
      ? `Finish step and start ${comboNextName}`
      : 'Finish last step';
  const endTitle = !comboRun
    ? 'Terminate Agent'
    : comboNextName
      ? `Finish this step — starts “${comboNextName}” (${comboRun.currentIndex + 2} / ${comboRun.steps.length})`
      : `Finish the last step of “${comboRun.label}”`;

  const runtime = formatAgentDuration(now - agent.startedAt);
  const showQuiet =
    (state === 'waiting' || state === 'stalled') && agent.lastActivityAt !== undefined;
  const durationLabel = showQuiet
    ? `quiet ${formatAgentDuration(now - (agent.lastActivityAt ?? now))}`
    : runtime;
  const durationTitle = showQuiet
    ? `No output for a while · running for ${runtime}`
    : 'Running for';

  const nameStem = displayName.replace(/…$/, '');
  const objectiveRepeatsName = !!agent.currentTask && agent.currentTask.startsWith(nameStem);
  const nameTooltip = [
    agent.name,
    agent.currentTask,
    agent.id,
    onRename && 'Double-click to rename',
  ]
    .filter(Boolean)
    .join(' · ');

  const showTerminal = viewMode === 'terminal';
  const logs = useStore(
    useCallback(
      (s) => (showTerminal ? (s.agentLogs[agent.id] ?? EMPTY_LOGS) : EMPTY_LOGS),
      [agent.id, showTerminal]
    )
  );

  const logPreview = useMemo(() => stripAnsi(logs.slice(-LOG_PREVIEW_CHUNKS).join('')), [logs]);

  useEffect(() => {
    if (viewMode === 'terminal') {
      logEndRef.current?.scrollIntoView({ behavior: scrollBehavior() });
    }
  }, [logs, viewMode]);

  useEffect(() => {
    if (isRenaming) nameInputRef.current?.select();
  }, [isRenaming]);

  useEffect(() => {
    if (viewMode === 'terminal') replyRef.current?.focus({ preventScroll: true });
  }, [viewMode]);

  const toggleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMode === 'terminal') setReplyError(null);
    setViewMode(viewMode === 'status' ? 'terminal' : 'status');
  };

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRenaming(true);
  };

  const commitRename = () => {
    if (!isRenaming) return;
    const next = nameInputRef.current?.value.trim() ?? '';
    setIsRenaming(false);
    if (next && next !== agent.name) onRename?.(agent.id, next);
  };

  const sendReply = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const input = e.currentTarget;
    const message = input.value;
    if (!message) return;

    setReplyError(null);
    try {
      const { writeToShell } = await import('@/lib/tauri/terminal');
      await writeToShell(`agent-${agent.id}`, `${message}\n`);
      input.value = '';
    } catch {
      setReplyError('Message could not be delivered. The agent may have exited.');
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.currentTarget.value = agent.name;
      setIsRenaming(false);
    }
  };

  const cardGlowClass =
    state === 'needs-input'
      ? 'border-amber-400/40 shadow-[0_0_25px_rgba(251,191,36,0.12)] hover:shadow-[0_0_35px_rgba(251,191,36,0.18)]'
      : state === 'stalled'
        ? 'border-orange-400/40 shadow-[0_0_25px_rgba(251,146,60,0.10)] hover:shadow-[0_0_35px_rgba(251,146,60,0.16)]'
        : isLive
          ? 'border-primary/50 shadow-[0_0_35px_rgba(var(--primary-rgb),0.25),0_0_70px_rgba(var(--primary-rgb),0.08)] hover:shadow-[0_0_45px_rgba(var(--primary-rgb),0.35)]'
          : isIdling
            ? 'border-amber-500/25 hover:border-amber-500/40 hover:shadow-[0_0_20px_rgba(245,158,11,0.08)]'
            : 'hover:border-primary/30 hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)]';

  return (
    <div
      onClick={() => onSelect?.(agent.id)}
      onContextMenu={onContextMenu && ((e) => onContextMenu(e, agent.id))}
      className={`glass-card group relative flex flex-col gap-2 rounded-xl p-2.5 transition-all duration-500 cursor-pointer overflow-hidden ${cardGlowClass} ${
        viewMode === 'terminal' ? 'min-h-[200px]' : ''
      } ${markerHex ? 'pl-4' : ''}`}
    >
      {markerHex && (
        <span
          data-testid="agent-color-marker"
          aria-label={`Marked ${markerLabel}`}
          role="img"
          className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
          style={{ backgroundColor: markerHex }}
        />
      )}

      {isLive && (
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent" />
      )}

      <AgentCardHeader
        agent={agent}
        displayName={displayName}
        isLive={isLive}
        isIdling={isIdling}
        isRunning={isRunning}
        viewMode={viewMode}
        isRenaming={isRenaming}
        nameInputRef={nameInputRef}
        nameTooltip={nameTooltip}
        durationTitle={durationTitle}
        durationLabel={durationLabel}
        state={state}
        comboRun={comboRun}
        endLabel={endLabel}
        endTitle={endTitle}
        onRename={onRename}
        onMinimize={onMinimize}
        onKill={onKill}
        startRename={startRename}
        commitRename={commitRename}
        handleNameKeyDown={handleNameKeyDown}
        toggleView={toggleView}
        cancelSkillCombo={cancelSkillCombo}
      />

      <div className="flex-1 min-h-0 relative">
        {viewMode === 'status' ? (
          <AgentCardStatusBody
            agentId={agent.id}
            agentName={agent.name}
            currentTask={agent.currentTask}
            currentActivity={agent.currentActivity}
            isRunning={isRunning}
            isLive={isLive}
            taskSummary={taskSummary}
            objectiveRepeatsName={objectiveRepeatsName}
            state={state}
            replyError={replyError}
            setReplyError={setReplyError}
            sendReply={sendReply}
          />
        ) : (
          <AgentCardTerminalBody
            agentName={agent.name}
            logs={logs}
            logPreview={logPreview}
            replyRef={replyRef}
            logEndRef={logEndRef}
            replyError={replyError}
            sendReply={sendReply}
          />
        )}
      </div>
    </div>
  );
}
