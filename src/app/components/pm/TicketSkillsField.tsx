'use client';

import { useState } from 'react';
import { SkillInvocationInput } from '@/app/components/cockpit/SkillInvocationInput';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { InfoTooltip } from '@/app/components/ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { normalizeTicketSkills } from '@/lib/pm/ticketSkills';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';

interface TicketSkillsFieldProps {
  skills: string[] | undefined;
  discovered: ProjectSkill[];
  onChange: (skills: string[]) => void;
}

export function TicketSkillsField({ skills, discovered, onChange }: TicketSkillsFieldProps) {
  const selected = normalizeTicketSkills(skills);
  const [draft, setDraft] = useState('');
  const remaining = discovered.filter((skill) => !selected.includes(skill.invocation));

  const add = (raw: string) => {
    const [invocation] = normalizeTicketSkills([raw]);
    if (!invocation) return;
    onChange(normalizeTicketSkills([...selected, invocation]));
    setDraft('');
  };

  const remove = (invocation: string) => {
    onChange(selected.filter((entry) => entry !== invocation));
  };

  return (
    <div>
      <label className="mb-2 flex items-center text-xs text-foreground-muted">
        Skills
        <InfoTooltip description={GUIDANCE.pm.skills} label="i" />
      </label>
      {selected.length > 0 && (
        <ul aria-label="Attached skills" className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((invocation) => {
            const found = discovered.find((skill) => skill.invocation === invocation);
            const name = found?.name ?? invocation;
            return (
              <li
                key={invocation}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-1 pl-2 pr-1"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[11px] text-foreground">{name}</span>
                  <span className="block truncate font-mono text-[10px] text-foreground-muted">
                    {invocation}
                  </span>
                </span>
                {found?.scope === 'user' && (
                  <span className="flex-shrink-0 text-[9px] uppercase tracking-wider text-foreground-muted/50">
                    yours
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => remove(invocation)}
                  className="rounded p-0.5 text-foreground-muted transition-colors hover:text-foreground"
                >
                  <AuricIcon name="close" aria-hidden="true" className="text-[14px]" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <SkillInvocationInput
        value={draft}
        discovered={remaining}
        suggestWhenEmpty
        ariaLabel="Add a skill"
        placeholder="Type / to add a skill"
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-foreground focus:border-primary/50 focus:outline-none"
        onChange={setDraft}
        onPick={(skill) => add(skill.invocation)}
        onEnterWithoutPick={add}
      />
    </div>
  );
}
