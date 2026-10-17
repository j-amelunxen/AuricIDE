'use client';

import { useState } from 'react';
import { formatAgentDuration } from '@/lib/agents/duration';
import { useNowWhen } from '@/lib/hooks/useNow';
import type {
  PolicyProposal,
  PolicyProposals,
  ProposalDecision,
  ProposalOutcome,
} from '@/lib/tauri/supervisorLink';

/** How many past decisions the block keeps in view. */
const RECENT_SHOWN = 5;

const OUTCOME_LABEL: Record<ProposalOutcome, string> = {
  applied: 'Applied',
  discarded: 'Discarded',
  expired: 'Expired',
  outdated: 'Outdated',
};

const BUTTON_CLASS =
  'rounded-md border border-white/10 px-2.5 py-1 text-xs text-foreground hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50';

function author(proposal: PolicyProposal): string {
  return proposal.proposedBy.name ?? proposal.proposedBy.agentId;
}

function PendingProposal({
  proposal,
  busy,
  onDecide,
}: {
  proposal: PolicyProposal;
  busy: boolean;
  onDecide: (decision: ProposalDecision) => void;
}) {
  // Re-rendered once a minute: the countdown is shown to the minute.
  const now = useNowWhen((tick) => Math.floor(tick / 60_000));
  const left = proposal.expiresAt - now;
  const busyReason = busy ? 'A decision is being stored' : undefined;
  return (
    <li
      data-testid={`supervisor-link-proposal-${proposal.id}`}
      className="space-y-1.5 rounded-lg border border-white/10 p-2"
    >
      <p className="flex flex-wrap gap-x-2 text-[11px] text-foreground-muted">
        <span>From {author(proposal)}</span>
        <span>{left > 0 ? `expires in ${formatAgentDuration(left)}` : 'expired'}</span>
      </p>
      <p className="text-xs text-foreground">{proposal.reason}</p>
      <ul className="space-y-0.5 rounded-md bg-white/5 px-2 py-1 font-mono text-[11px] text-foreground">
        {proposal.diff.map((line, index) => (
          <li key={index} className="break-all whitespace-pre-wrap">
            {line}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          title={busyReason}
          onClick={() => onDecide('apply')}
          className={BUTTON_CLASS}
        >
          Apply
        </button>
        <button
          type="button"
          disabled={busy}
          title={busyReason}
          onClick={() => onDecide('discard')}
          className={BUTTON_CLASS}
        >
          Discard
        </button>
      </div>
    </li>
  );
}

/**
 * Changes a supervisor asked for. Nothing it proposes takes effect until a
 * person applies it here or on the inbox question Rust raised for it; past
 * decisions stay listed so a change to what the link sees has a record.
 */
export function ProposalsBlock({
  proposals,
  onDecide,
}: {
  proposals: PolicyProposals | null;
  onDecide: (proposalId: string, decision: ProposalDecision) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (proposalId: string, decision: ProposalDecision) => {
    setBusy(true);
    setError(await onDecide(proposalId, decision));
    setBusy(false);
  };

  const recent = [...(proposals?.recent ?? [])].sort((a, b) => b.at - a.at).slice(0, RECENT_SHOWN);

  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 p-3">
      <p className="text-xs font-semibold text-foreground">Proposals</p>
      <p className="text-[10px] text-foreground-muted">
        A supervisor may propose a change to these settings. It takes effect only once you apply it.
      </p>
      {error && (
        <p role="alert" className="text-[11px] text-red-400">
          {error}
        </p>
      )}
      {!proposals ? null : proposals.pending.length === 0 ? (
        <p data-testid="supervisor-link-proposals-empty" className="text-xs text-foreground-muted">
          No proposals are waiting.
        </p>
      ) : (
        <ul className="space-y-2">
          {proposals.pending.map((proposal) => (
            <PendingProposal
              key={proposal.id}
              proposal={proposal}
              busy={busy}
              onDecide={(decision) => void decide(proposal.id, decision)}
            />
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <div data-testid="supervisor-link-recent" className="space-y-0.5 pt-1">
          <p className="text-[10px] font-semibold tracking-wide text-foreground-muted">
            Last decisions
          </p>
          <ul className="space-y-0.5">
            {recent.map((entry) => (
              <li
                key={`${entry.id}-${entry.at}`}
                className="flex flex-wrap gap-x-2 text-[11px] text-foreground-muted"
              >
                <span className="font-semibold text-foreground">
                  {OUTCOME_LABEL[entry.outcome]}
                </span>
                <span>{entry.reason}</span>
                <time className="tabular-nums" dateTime={new Date(entry.at).toISOString()}>
                  {new Date(entry.at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
