'use client';

import type { ReactNode } from 'react';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import { countNeedingAttention, withReviewFlags } from '@/lib/agents/attention';
import { UNGROUPED_REPO_KEY } from '@/lib/store/agentSlice';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface DailyTip {
  icon: string;
  text: ReactNode;
}

/**
 * The start screen's Tip of the Day is trivia; "3 agents are working right
 * now" is not. This replaces the tip the moment anything is actually
 * running, with a one-click way into the Agent Console.
 *
 * A leaf on purpose: it ticks on useNow for the attention clock, and lifting
 * that 1 Hz timer to the page root would re-render the whole IDE every
 * second — the same reasoning as AttentionTitle in page.tsx.
 */
export function StartScreenAgentsLine({ dailyTip }: { dailyTip: DailyTip }) {
  const agents = useStore((s) => s.agents);
  const reviewedAgentIds = useStore((s) => s.reviewedAgentIds);
  const openAgentConsole = useStore((s) => s.openAgentConsole);
  const now = useNow();

  const runningAgents = agents.filter((a) => a.status === 'running');

  if (runningAgents.length === 0) {
    return (
      <div className="mx-auto mt-6 w-full min-w-0 max-w-3xl text-left" data-testid="tip-of-the-day">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted mb-2">
          Tip of the Day
        </h2>
        <div className="flex items-start gap-3 rounded-2xl bg-primary/5 border border-primary/10 px-4 py-3">
          <AuricIcon name={dailyTip.icon} className="text-primary-light text-base mt-0.5" />
          <p className="text-[12px] text-foreground-muted leading-relaxed">{dailyTip.text}</p>
        </div>
      </div>
    );
  }

  const projectCount = new Set(runningAgents.map((a) => a.repoPath ?? UNGROUPED_REPO_KEY)).size;
  const agentPhrase = runningAgents.length === 1 ? '1 agent' : `${runningAgents.length} agents`;
  const projectPhrase = projectCount === 1 ? 'in 1 project' : `across ${projectCount} projects`;

  const attentionCount = countNeedingAttention(withReviewFlags(agents, reviewedAgentIds), now);

  return (
    <div
      className="mt-6 flex w-full min-w-0 max-w-3xl flex-wrap items-center justify-center gap-2 text-[12px] text-foreground-muted"
      data-testid="start-screen-agents-line"
    >
      <span>
        {agentPhrase} running {projectPhrase}
      </span>
      <span aria-hidden="true">·</span>
      <button
        onClick={openAgentConsole}
        className="font-bold text-primary-light transition-colors hover:text-primary"
      >
        Open Agent Console
      </button>
      {attentionCount > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span
            data-testid="start-screen-agents-attention-count"
            className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-400 tabular-nums"
          >
            {attentionCount} {attentionCount === 1 ? 'needs' : 'need'} you
          </span>
        </>
      )}
    </div>
  );
}
