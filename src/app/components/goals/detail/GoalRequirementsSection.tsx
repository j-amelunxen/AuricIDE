'use client';

import { useState, useMemo } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { PmGoalRequirementLink } from '@/lib/tauri/goals';
import type { PmRequirement } from '@/lib/tauri/requirements';

export interface GoalRequirementsSectionProps {
  goalId: string;
  hasTickets: boolean;
  requirements: PmRequirement[];
  requirementLinks: PmGoalRequirementLink[];
  onLinkRequirement: (goalId: string, requirementId: string) => void;
  onUnlinkRequirement: (goalId: string, requirementId: string) => void;
  labelCls: string;
}

export function GoalRequirementsSection({
  goalId,
  hasTickets,
  requirements,
  requirementLinks,
  onLinkRequirement,
  onUnlinkRequirement,
  labelCls,
}: GoalRequirementsSectionProps) {
  const [reqPickerValue, setReqPickerValue] = useState('');

  const linkedRequirements = useMemo(() => {
    const ids = new Set(
      requirementLinks.filter((l) => l.goalId === goalId).map((l) => l.requirementId)
    );
    return requirements.filter((r) => ids.has(r.id));
  }, [goalId, requirements, requirementLinks]);

  const linkableRequirements = useMemo(() => {
    const linked = new Set(linkedRequirements.map((r) => r.id));
    return requirements.filter((r) => !linked.has(r.id));
  }, [requirements, linkedRequirements]);

  return (
    <div>
      <label className={labelCls}>Requirements</label>
      {linkedRequirements.length === 0 && hasTickets && (
        <p
          data-testid="goal-no-requirement-hint"
          className="mb-1.5 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-300/90"
        >
          <AuricIcon name="info" className="mt-px text-[12px]" />
          No requirement linked. This goal completes when agents finish successfully. Link a
          requirement to add a verified completion check.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {linkedRequirements.map((r) => (
          <span
            key={r.id}
            data-testid={`goal-req-chip-${r.id}`}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
              r.status === 'verified'
                ? 'bg-green-500/15 text-green-300'
                : 'bg-amber-500/15 text-amber-300'
            }`}
          >
            {r.reqId}
            <button
              data-testid={`goal-req-unlink-${r.id}`}
              onClick={() => onUnlinkRequirement(goalId, r.id)}
              className="text-[10px] opacity-60 hover:opacity-100"
              title="Unlink"
            >
              <AuricIcon name="close" />
            </button>
          </span>
        ))}
      </div>
      {linkableRequirements.length > 0 && (
        <select
          data-testid="goal-req-picker"
          value={reqPickerValue}
          onChange={(e) => {
            if (e.target.value) {
              onLinkRequirement(goalId, e.target.value);
              setReqPickerValue('');
            }
          }}
          className="mt-1.5 rounded-lg bg-white/5 px-2 py-1 text-[10px] text-foreground-muted outline-none"
        >
          <option value="" className="bg-background-dark">
            + Link requirement…
          </option>
          {linkableRequirements.map((r) => (
            <option key={r.id} value={r.id} className="bg-background-dark">
              {r.reqId} · {r.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
