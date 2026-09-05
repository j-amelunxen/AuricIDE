import type { AgentConfig } from '@/lib/tauri/agents';
import type { PmGoal } from '@/lib/tauri/goals';
import type { SpawnPreset } from '@/lib/agents/spawnDefaults';

export const YOLO_ELEVATE_ACK_KEY = 'auric.yolo-elevate-acknowledged';

export interface SpawnAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSpawn: (config: AgentConfig) => void | Promise<void>;
  initialTask?: string;
  spawnedByTicketId?: string | null;
  initialRepoPath?: string;
  recentPaths?: string[];
  /** Goals available for binding the agent's work to a goal. */
  goals?: PmGoal[];
  initialGoalId?: string | null;
  /** Previously used start prompts, newest first — recalled with ArrowUp. */
  promptHistory?: string[];
  /**
   * Launch choices pinned by the Quick Access skill that opened the dialog.
   * Takes precedence over the remembered defaults, but is validated the same
   * way: a provider or model that no longer exists degrades to the provider's
   * own defaults rather than breaking the launch.
   */
  presetDefaults?: SpawnPreset | null;
  /**
   * The state the launch pins on the "New git worktree" box: `false` from a
   * Quick Access skill, which is aimed at the repository the user is looking
   * at. Null lets the box follow the working directory, as every other entry
   * point does. The user's own toggle still wins, and switching the working
   * directory drops the pin with it.
   */
  worktreeDefault?: boolean | null;
}
