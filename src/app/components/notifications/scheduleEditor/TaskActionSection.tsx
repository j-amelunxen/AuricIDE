'use client';

import type { PermissionMode } from '@/lib/tauri/agents';
import type { ProviderInfo } from '@/lib/tauri/providers';
import type { TaskLaunchDraft } from './types';
import { Choice, INPUT, SUBLABEL } from './ui';

export interface TaskActionSectionProps {
  task: string;
  onTaskChange: (task: string) => void;
  providerId?: string;
  model?: string;
  permissionMode?: PermissionMode;
  launch?: 'auto' | 'direct';
  headless?: boolean;
  providers: ProviderInfo[];
  onChooseProvider: (providerId: string) => void;
  onSetTaskLaunch: (patch: TaskLaunchDraft) => void;
}

export function TaskActionSection({
  task,
  onTaskChange,
  providerId,
  model,
  permissionMode,
  launch,
  headless,
  providers,
  onChooseProvider,
  onSetTaskLaunch,
}: TaskActionSectionProps) {
  const taskProvider = providerId
    ? providers.find((provider) => provider.id === providerId)
    : undefined;

  return (
    <div className="mt-2">
      <input
        data-testid="schedule-task"
        value={task}
        onChange={(event) => onTaskChange(event.target.value)}
        placeholder="Run a server scan"
        className={INPUT}
      />

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className={SUBLABEL}>Agent</span>
          <select
            data-testid="schedule-task-provider"
            value={providerId ?? ''}
            onChange={(event) => onChooseProvider(event.target.value)}
            className={INPUT}
          >
            <option value="">Same as last launch</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={SUBLABEL}>Model</span>
          <select
            data-testid="schedule-task-model"
            disabled={taskProvider === undefined}
            value={model ?? ''}
            onChange={(event) => onSetTaskLaunch({ model: event.target.value || undefined })}
            className={`${INPUT} disabled:opacity-40`}
          >
            <option value="">{taskProvider?.defaultModel ?? 'Pick an agent first'}</option>
            {(taskProvider?.models ?? []).map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-2 block">
        <span className={SUBLABEL}>Permission</span>
        <select
          data-testid="schedule-task-permission"
          disabled={taskProvider === undefined}
          value={permissionMode ?? ''}
          onChange={(event) =>
            onSetTaskLaunch({
              permissionMode: (event.target.value || undefined) as PermissionMode,
            })
          }
          className={`${INPUT} disabled:opacity-40`}
        >
          <option value="">Same as last launch</option>
          {(taskProvider?.permissionModes ?? []).map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[9px] text-foreground-muted/60">
          How far the agent gets on its own before it stops to ask you.
        </p>
      </label>

      <fieldset className="mt-2">
        <legend className={SUBLABEL}>Launch</legend>
        <div className="flex flex-col gap-1">
          <Choice
            name="schedule-task-launch"
            testId="schedule-task-launch-auto"
            label="Start by itself"
            checked={launch === 'auto'}
            onSelect={() => onSetTaskLaunch({ launch: 'auto', headless: true })}
          />
          <Choice
            name="schedule-task-launch"
            testId="schedule-task-launch-direct"
            label="Start on click"
            checked={launch !== 'auto'}
            onSelect={() => onSetTaskLaunch({ launch: 'direct' })}
          />
        </div>
        {launch === 'auto' && (
          <p
            data-testid="schedule-task-auto-hint"
            className="mt-1 text-[9px] text-foreground-muted/60"
          >
            Runs in the named folder even while you are working. Does not switch project or steal
            the terminal.
          </p>
        )}
      </fieldset>

      <label className="mt-2 flex items-start gap-2 text-[11px] text-foreground">
        <input
          type="checkbox"
          data-testid="schedule-task-headless"
          checked={headless === true}
          onChange={(event) => onSetTaskLaunch({ headless: event.target.checked })}
          className="mt-[2px]"
        />
        <span>
          Headless
          <span className="mt-0.5 block text-[9px] text-foreground-muted/60">
            Runs unattended and exits when the work is done. You get a notification when it
            finishes.
          </span>
        </span>
      </label>
    </div>
  );
}
