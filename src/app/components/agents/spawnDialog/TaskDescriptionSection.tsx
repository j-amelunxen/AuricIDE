import type { RefObject, KeyboardEvent } from 'react';
import { InfoTooltip } from '@/app/components/ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { SkillInvocationInput } from '@/app/components/cockpit/SkillInvocationInput';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { spawnAttachmentLabel } from '@/lib/agents/spawnAttachments';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';

interface TaskDescriptionSectionProps {
  taskRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  task: string;
  onTaskChange: (next: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  discovered: ProjectSkill[];
  attachments: string[];
  onRemoveAttachment: (path: string) => void;
  promptHistory: string[];
}

export function TaskDescriptionSection({
  taskRef,
  task,
  onTaskChange,
  onKeyDown,
  discovered,
  attachments,
  onRemoveAttachment,
  promptHistory,
}: TaskDescriptionSectionProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor="task-desc"
        className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
      >
        What should it do?
        <InfoTooltip description={GUIDANCE.agents.task} label="i" />
      </label>
      <SkillInvocationInput
        id="task-desc"
        multiline
        completeToken
        fieldRef={taskRef}
        value={task}
        discovered={discovered}
        ariaLabel="What should it do?"
        placeholder="What should the agent achieve?"
        className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors resize-none min-h-[100px]"
        onChange={onTaskChange}
        onKeyDown={onKeyDown}
      />
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 pt-1">
          {attachments.map((path) => (
            <li
              key={path}
              className="flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-foreground"
            >
              <AuricIcon name="image" className="text-[12px] text-foreground-muted" />
              <span className="max-w-[10rem] truncate">{spawnAttachmentLabel(path)}</span>
              <button
                type="button"
                aria-label={`Remove ${spawnAttachmentLabel(path)}`}
                onClick={() => onRemoveAttachment(path)}
                className="text-foreground-muted hover:text-foreground"
              >
                <AuricIcon name="close" className="text-[12px]" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-foreground-muted">
        Drop or paste an image — it goes out with the prompt
        {discovered.length > 0 && <span data-testid="skill-complete-hint"> · / picks a skill</span>}
        {promptHistory.length > 0 && (
          <span data-testid="prompt-history-hint"> · ↑ recalls an earlier prompt</span>
        )}
      </p>
    </div>
  );
}
