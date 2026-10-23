'use client';

import { useProjectManagers } from '@/lib/hooks/useProjectManagers';
import type { ManagerActionDraft } from './types';
import { Choice, INPUT, SUBLABEL } from './ui';

export interface ManagerActionSectionProps {
  draft: ManagerActionDraft;
  onSetManagerDraft: (patch: Partial<ManagerActionDraft>) => void;
}

const AUTO_HINT =
  'Starts by itself when the reminder arrives, in the background and without switching your project. A running manager gets the task as a message.';

/**
 * Picks the Project Manager a reminder opens, and what to hand it. Managers
 * that cannot be opened (archived, folder missing) are not offered; one that
 * was saved and since became unavailable stays visible so the reminder does
 * not quietly point at something else.
 */
export function ManagerActionSection({ draft, onSetManagerDraft }: ManagerActionSectionProps) {
  const { managers } = useProjectManagers();
  const offered = managers
    .filter((manager) => manager.archivedAt === null && manager.runMissing !== true)
    .sort((a, b) => a.name.localeCompare(b.name));
  const savedUnavailable =
    draft.managerKey !== '' && !offered.some((manager) => manager.key === draft.managerKey);

  return (
    <div className="mt-2">
      <label className="block">
        <span className={SUBLABEL}>Project Manager</span>
        <select
          data-testid="schedule-manager"
          value={draft.managerKey}
          onChange={(event) => {
            const picked = offered.find((manager) => manager.key === event.target.value);
            onSetManagerDraft({
              managerKey: picked?.key ?? '',
              managerName: picked?.name ?? '',
            });
          }}
          className={INPUT}
        >
          <option value="">Choose a Project Manager…</option>
          {savedUnavailable && (
            <option value={draft.managerKey}>{draft.managerName} (not available)</option>
          )}
          {offered.map((manager) => (
            <option key={manager.key} value={manager.key}>
              {manager.name}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-2 block">
        <span className={SUBLABEL}>Task</span>
        <textarea
          data-testid="schedule-manager-task"
          value={draft.task}
          onChange={(event) => onSetManagerDraft({ task: event.target.value })}
          rows={3}
          placeholder="Leave empty to just open it"
          className={`${INPUT} resize-y`}
        />
      </label>

      <fieldset className="mt-2">
        <legend className={SUBLABEL}>Launch</legend>
        <div className="flex flex-col gap-1">
          <Choice
            name="schedule-manager-launch"
            testId="schedule-manager-launch-auto"
            label="Start by itself"
            checked={draft.launch === 'auto'}
            onSelect={() => onSetManagerDraft({ launch: 'auto' })}
          />
          <Choice
            name="schedule-manager-launch"
            testId="schedule-manager-launch-direct"
            label="Start on click"
            checked={draft.launch === 'direct'}
            onSelect={() => onSetManagerDraft({ launch: 'direct' })}
          />
        </div>
        {draft.launch === 'auto' && (
          <p
            data-testid="schedule-manager-auto-hint"
            className="mt-1 text-[11px] text-foreground-muted"
          >
            {AUTO_HINT}
          </p>
        )}
      </fieldset>
    </div>
  );
}
