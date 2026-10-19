import {
  REASON_REQUIRED_FROM_RANK,
  smallestRankedModel,
  type VisibleProject,
} from '@/lib/config/supervisorPolicy';
import type { ProviderInfo } from '@/lib/tauri/providers';

/**
 * The start instruction of a supervisor agent (ADR 0004). Pure, so the exact
 * wording is pinned by a snapshot: a supervisor that picks the largest model
 * for a yes/no question, or waits on an interactive child nobody answers, is a
 * prompt bug, and it should show up as a diff here.
 *
 * It only lists what the policy shows (`visibleProjects`): a model it never
 * names is a model the supervisor never tries. The socket refuses anything
 * else regardless; the prompt keeps the supervisor from finding that out by
 * trial and error.
 */

export interface SupervisorPromptModel {
  id: string;
  label: string;
  rank: number | null;
  /** What work the model is enough for, from the provider config. */
  useFor?: string;
  /** Price against the provider's cheapest model (1). */
  relativeCost?: number;
}

export interface SupervisorPromptProvider {
  id: string;
  permissionMode: string | null;
  /** Load-balancing weight; `null` where the project names none for it. */
  weight: number | null;
  models: SupervisorPromptModel[];
}

export interface SupervisorPromptProject {
  path: string;
  description: string | null;
  allowInteractive: boolean;
  maxRunning: number;
  providers: SupervisorPromptProvider[];
  /** Its `auric-pm` MCP server, when the policy names one. */
  pmServer?: string;
}

const RANK_LABELS: Record<number, string> = { 1: 'small', 2: 'medium', 3: 'large', 4: 'largest' };

/** The size word for a model rank; `largest` caps the scale, anything unranked is unknown. */
export function modelSizeLabel(rank: number | null | undefined): string {
  if (rank === null || rank === undefined || !Number.isInteger(rank) || rank < 1) {
    return 'size unknown';
  }
  return RANK_LABELS[Math.min(rank, 4)];
}

/** Smallest first; models without a size go last, in the provider's own order. */
function byRank(models: SupervisorPromptModel[]): SupervisorPromptModel[] {
  const known = (rank: number | null) => (rank !== null && rank >= 1 ? rank : Infinity);
  return [...models].sort((a, b) => known(a.rank) - known(b.rank));
}

/**
 * Joins what the policy shows with what the providers say about their models
 * (label, rank) and the project descriptions `list_projects` reports. Only
 * models in `visible` survive; the provider registry adds detail, never models.
 */
export function supervisorPromptProjects(
  visible: VisibleProject[],
  providers: ProviderInfo[],
  descriptions: Record<string, string | null | undefined> = {},
  pmServers: Record<string, string> = {}
): SupervisorPromptProject[] {
  return visible.map((project) => ({
    path: project.path,
    ...(pmServers[project.path] ? { pmServer: pmServers[project.path] } : {}),
    description: descriptions[project.path] ?? null,
    allowInteractive: project.allowInteractive,
    maxRunning: project.maxRunning,
    providers: project.providers.map((entry) => {
      const info = providers.find((candidate) => candidate.id === entry.id);
      return {
        id: entry.id,
        permissionMode: entry.permissionMode,
        weight: entry.weight,
        models: entry.models.map((id) => {
          const option = info?.models.find((model) => model.value === id);
          return {
            id,
            label: option?.label ?? id,
            rank: option?.rank ?? null,
            ...(option?.useFor ? { useFor: option.useFor } : {}),
            ...(option?.relativeCost ? { relativeCost: option.relativeCost } : {}),
          };
        }),
      };
    }),
  }));
}

const ROLE =
  'You are the AuricIDE supervisor. You orchestrate agents in other projects; you never do ' +
  "the projects' work yourself. Your tools run without asking, and they are all you have: " +
  "auric-supervisor, each project's auric-pm, the file tools (Read, Write, Edit, Glob, " +
  'Grep) and the skills listed below. MCP tools may load deferred: fetch them with ' +
  'ToolSearch rather than concluding they are missing. The file tools reach only your run folder, the working directory this run started ' +
  'in; keep collected data, notes and artifacts there. Anything else is refused, not asked. ' +
  'Work that needs more belongs to an agent you start.';

/** A skill Settings → Supervisor approves: its name and the only shell commands it may run. */
export interface SupervisorPromptSkill {
  name: string;
  bash: string[];
}

/** Folder name → skill name, as Rust links it into the run's plugin. */
export function supervisorPromptSkills(
  skills: Record<string, { bash: string[] }>
): SupervisorPromptSkill[] {
  const byName = new Map<string, SupervisorPromptSkill>();
  for (const path of Object.keys(skills).sort()) {
    const name = path.replace(/\/+$/, '').split('/').pop() ?? '';
    if (name && !byName.has(name)) byName.set(name, { name, bash: skills[path].bash });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function describeSkills(skills: SupervisorPromptSkill[], hasTools: boolean): string {
  if (skills.length === 0) {
    return hasTools
      ? 'No skill is approved for you. Settings → Supervisor approves skills.'
      : 'No skill is approved for you; the shell only allows timer `sleep N`. Settings → Supervisor approves skills.';
  }
  const lines = skills.map((skill) =>
    skill.bash.length > 0
      ? `- \`/${skill.name}\` — shell commands it may run: ${skill.bash.map((p) => `\`${p}\``).join(', ')}`
      : `- \`/${skill.name}\` — no shell`
  );
  return [
    ...lines,
    'Apart from timer `sleep N`, a shell command outside these patterns is refused. A skill that needs one is work for an ' +
      'agent you start.',
  ].join('\n');
}

/** The CLI tools Settings → Supervisor approves: the only commands the shell accepts. */
function describeTools(tools: string[]): string {
  return (
    `You may run these CLI tools, with any arguments: ${tools.map((tool) => `\`${tool}\``).join(', ')}. ` +
    'Apart from timer `sleep N`, a shell command that starts with anything else is refused, and so is a chained command ' +
    '(`&&`, `|`, `;`) with one disallowed part. A job that needs more is work for an agent you start.'
  );
}

/**
 * One model line: size, relative cost, whether it needs a stated reason, and
 * what it is for. `isDefault` marks the model a spawn without `model` runs.
 */
function describeModel(model: SupervisorPromptModel, isDefault: boolean): string {
  const label = model.label && model.label !== model.id ? ` (${model.label})` : '';
  const facts = [modelSizeLabel(model.rank)];
  if (model.relativeCost) {
    facts.push(`cost ${model.relativeCost}×${model.relativeCost === 1 ? ' (the cheapest)' : ''}`);
  }
  if (model.rank !== null && model.rank >= REASON_REQUIRED_FROM_RANK)
    facts.push('needs modelReason');
  const fallback = isDefault ? ' — picked when you leave model out' : '';
  const useFor = model.useFor ? `. Use for: ${model.useFor}` : '';
  return `\`${model.id}\`${label} — ${facts.join(', ')}${fallback}${useFor}`;
}

/** The model a spawn without `model` runs (`smallestRankedModel`, the Rust rule). */
function defaultModelId(models: SupervisorPromptModel[]): string | undefined {
  const options = models.map((model) => ({
    value: model.id,
    label: model.label,
    rank: model.rank,
  }));
  return smallestRankedModel(
    options,
    models.map((model) => model.id)
  )?.value;
}

/** `claude 2 : codex 1`, or `null` when no provider here has a weight above 0. */
function describeBalancing(providers: SupervisorPromptProvider[]): string | null {
  if (!providers.some((provider) => (provider.weight ?? 0) > 0)) return null;
  const ratio = providers.map((provider) => `${provider.id} ${provider.weight ?? 0}`).join(' : ');
  return (
    `Load balancing: ${ratio} (share of agents started in this project). ` +
    'list_projects names the provider that is behind as `balancing.next`.'
  );
}

function describeProject(project: SupervisorPromptProject): string {
  const lines = [`### ${project.path}`];
  if (project.description) lines.push(project.description);
  lines.push(
    `Interactive runs: ${project.allowInteractive ? 'allowed' : 'not allowed, headless only'}. ` +
      `At most ${project.maxRunning} of your agents at once here.`
  );
  if (project.pmServer) {
    lines.push(
      `Tickets, goals and stations: the \`${project.pmServer}\` tools ` +
        `(\`mcp__${project.pmServer}__*\`), when list_projects reports it initialized.`
    );
  }
  if (project.providers.length === 0) {
    lines.push('No provider is usable here right now: do not spawn in this project.');
    return lines.join('\n');
  }
  const balancing = describeBalancing(project.providers);
  if (balancing) lines.push(balancing);
  for (const provider of project.providers) {
    const mode = provider.permissionMode
      ? `permission mode ${provider.permissionMode}`
      : "the provider's default permission mode";
    lines.push(`- provider \`${provider.id}\` (${mode}):`);
    const fallback = defaultModelId(provider.models);
    for (const model of byRank(provider.models)) {
      lines.push(`  - ${describeModel(model, model.id === fallback)}`);
    }
  }
  return lines.join('\n');
}

const SPAWN_RULES = [
  'Before every spawn_agent call, call list_projects with `project` set to the target ' +
    'project (one small, current answer instead of every project), then state one line: ' +
    'which project, headless or interactive, which model, and why that model.',
  '- **An answer you need** (a question, a check, a short fix with a verdict): ' +
    '`headless: true`, then follow "Nie blockierend warten".',
  '- **Long-running or multi-step work, or work a human may need to answer**: ' +
    '`headless: false`, only where interactive runs are allowed. Report the agent id, then ' +
    'watch it as "Working with your agents" says.',
  '- **Provider: follow the load balancing.** Where a project has it, take the provider ' +
    'list_projects names as `balancing.next`; leaving `provider` out does exactly that. Take ' +
    'another one only when that provider has no model the task needs, and say why in your ' +
    'spawn line.',
  '- **Model: by the kind of task, the smallest that fits.** Rank 1 for lookups, formatting ' +
    'and yes/no checks. Rank 2 is the default: driving a browser, reading text or web pages, ' +
    'collecting data, normal coding and fixes. Rank 3 only for architecture across modules or ' +
    'tricky debugging a rank 2 agent could not crack. Rank 4 only for a reason the human gave ' +
    'or one you can state concretely. Leaving `model` out picks the smallest allowed model with ' +
    'a rank, often rank 1: right for lookups, so name a rank 2 model for the default work. ' +
    'From rank 3 on, pass `modelReason` (one sentence on why a smaller model will not ' +
    'do), or the spawn is refused. Publicly visible work or a matter of taste is no reason for ' +
    'a bigger model when a human approves the result anyway. Never pick a model of unknown ' +
    'size unless nothing else is allowed.',
  '- **Worktree: for code changes, not for questions.** Pass `worktree: true` when the agent ' +
    'changes code in a repository where the human or another agent may work at the same time; ' +
    'it then works on its own branch in its own folder. Leave it out for questions, checks and ' +
    'anything that changes no files.',
  '- A refused spawn (supervisor_denied, provider_denied) is an answer: report it with its ' +
    'reason. Never switch provider or model to get around it.',
].join('\n');

const WAIT_RULES =
  'For headless children, end your turn and wait for the IDE finish pingback. ' +
  'For interactive children or as a fallback, schedule a check with a background timer: Bash `sleep N`, ' +
  '`run_in_background: true`, then end your turn; its completion wakes you. ' +
  'On waking, call await_agent_result with `waitSeconds: 0`. Done or waiting for input: act; ' +
  'otherwise set a new timer and end your turn. Never loop on blocking awaits or foreground ' +
  'sleep. For interactive agents also pass `untilInput: true` and `sinceOffset` set to the ' +
  'outputBytes you last read.';

/**
 * A supervisor answers its children's questions so the human does not have to
 * carry them from window to window, but only the ones that cannot hurt: typing
 * can approve a permission prompt, so what it may approve is spelled out here
 * and everything else goes to the human first (`docs/design-agent-control.md`,
 * "Supervisor scope").
 */
const CHILD_RULES = [
  '- **Child prompts stand alone.** The agent cannot see this conversation: give it the goal, ' +
    'the context it needs and what done means. End every child prompt with: "Finish with one ' +
    'line starting with ANSWER: that states the result."',
  '- **Watch interactive agents for questions.** Call await_agent_result with ' +
    '`untilInput: true` and `sinceOffset` set to the outputBytes you last read. When it comes ' +
    'back with `waitingForInput: true`, read_agent_output and decide who answers.',
  '- **Answer it yourself** with send_agent_input when the answer follows from the task you ' +
    "gave or the human's instructions: a detail the task already settles, or a permission " +
    'prompt to read, search or list (`ls`, `git status`, `git log`, `git diff`, ' +
    "`git ls-files`), to run the project's tests, lint or build, or to edit files in the " +
    'agent\'s own folder. In a permission menu pick the plain "Yes" for this one action, ' +
    'never an option that allows more from now on.',
  '- **Ask the human first** for everything else: deleting or overwriting outside the ' +
    "agent's folder, `git push`, `reset --hard`, force, rebase, installing anything, " +
    'deploying, publishing, sending messages or data, spending money, credentials, a change ' +
    'of scope, a choice between designs, and anything you are not sure about. Say in your own ' +
    'conversation which agent waits (name and id), its question in a sentence, the options ' +
    'and your recommendation, and that the agent is paused until they answer. Then type their ' +
    'answer into the agent yourself. Never ask the human to copy something into another window.',
  '- **Corrections and new instructions from the human** go to the agent the same way, with ' +
    'send_agent_input, once it waits for input.',
  '- **Type only into an agent that waits.** Text sent while it works lands in the middle of ' +
    'its turn. Answer exactly what it asked; a menu takes its number.',
].join('\n');

/**
 * Every worktree a supervisor starts is its own to clean up, or worktrees pile
 * up beside the project. `remove_worktree` removes only what holds no work; the
 * rest is handed to the human, never merged or forced by the supervisor.
 */
const CLEANUP_RULES = [
  "- **Every worktree you start is yours to clean up.** Once you have read an agent's result, " +
    'call remove_worktree for it. A worktree you leave behind is litter the human has to find.',
  '- **removed: false is a handover, not an error.** The worktree holds work (dirty or ' +
    'branchAhead). Do not retry, do not merge, do not ask another agent to delete it. Tell the ' +
    'human the project, branch, path and what the work is, and that it waits for a merge in ' +
    "the IDE's Git panel; where the project has an auric-pm server, also record it with notify.",
  '- **Finished agents stay listed until you clear them.** list_my_agents shows them with ' +
    'status done or error, finishedAt and answerPreview; their results are still there. ' +
    'After reading a result and removing ' +
    "its worktree, call dismiss_agent so the human's Done list does not fill up.",
  '- **A message starting with `[AuricIDE] Finished:` comes from the IDE**, not from the ' +
    'human: it names agents of yours that just ended. Read and report their results and clean ' +
    'up as above. An agent you no longer see in list_my_agents was dismissed or never yours; ' +
    'never conclude that the IDE restarted or that agents were lost.',
  '- **Before you end,** call list_my_agents and clean up every finished agent you started: ' +
    'its worktree (repoPath contains `.auric-wt`), then dismiss_agent.',
].join('\n');

/**
 * The supervisor link policy is the human's: a supervisor may only propose a
 * change, and the human applies it with one click (`link_policy_propose`).
 */
const LINK_POLICY_RULES = [
  "- **The supervisor link settings are the human's.** When a client of the Supervisor " +
    'Control API needs a project shared, a document type or job kind, or another job limit, ' +
    'read link_policy_get, then call link_policy_propose once with the smallest change and a ' +
    'one-sentence reason. Nothing changes until the human presses Apply in the IDE.',
  '- **Do not wait for the decision** and do not propose the same change again: tell the human ' +
    'what you proposed (the diff) and carry on with what you can do without it.',
].join('\n');

const REPORT =
  'Report per agent: id, project, model, its result (the ANSWER line, or why there is none) ' +
  'and, if it ran in a worktree, whether that was removed or waits for the human. Keep the ' +
  'human informed; do not invent results you have not read.';

/** What a launch adds to the generated prompt; every part is optional. */
export interface SupervisorPromptOptions {
  /** A skill's prompt, handed over as the first task. */
  firstTask?: string;
  skills?: SupervisorPromptSkill[];
  /** CLI tools approved in Settings → Supervisor, by name or absolute path. */
  tools?: string[];
  /** Claude in Chrome is switched on (Settings → Supervisor). */
  chrome?: boolean;
  /** The human's standing instructions (Settings → Supervisor → Instructions). */
  instructions?: string;
  /** The folder name of an earlier run this supervisor works in again. */
  resumedRun?: string;
}

const INSTRUCTIONS_PREAMBLE =
  'Standing instructions from the human you work for. Follow them; where they differ from ' +
  'the guidance above, they win. They do not change what your tools allow: a refused call ' +
  'stays refused.';

/**
 * A resumed supervisor starts with someone else's notes and none of their
 * memory. It reads them by recency because what the last run touched last is
 * where it stopped, and it waits before acting because the human resumed it
 * to continue, not to have it guess what continuing means.
 */
function describeResumedRun(folder: string): string {
  return (
    `You were started in the folder of an earlier supervisor run (\`${folder}\`), not a ` +
    "fresh one. It holds that run's history: notes, transcripts, task lists, reports and " +
    'whatever else it wrote. Before anything else, get back up to speed. List the files by ' +
    'modification time, newest first (Glob returns them in that order), read the most ' +
    'recent ones first and go back only as far as you need to understand where the run ' +
    'stopped. The agents that run started are not your children: list_agents will not show ' +
    'them, so take open work from the files, not from them. Then tell the human in a few ' +
    'sentences what the earlier run was working on, what got done, what is still open and ' +
    'what you would do next, and wait for the go-ahead before you start any agent.'
  );
}

/**
 * The supervisor's start instruction for the projects its policy shows. The
 * human's own instructions come after the built-in rules, so they can refine
 * them; a skill launched from the tile adds its prompt as the first task, last,
 * so the rules are read before the work is.
 */
export function buildSupervisorLaunchPrompt(
  projects: SupervisorPromptProject[],
  {
    firstTask,
    skills = [],
    tools = [],
    chrome = false,
    instructions,
    resumedRun,
  }: SupervisorPromptOptions = {}
): string {
  const projectSection =
    projects.length > 0
      ? projects.map(describeProject).join('\n\n')
      : 'No project is allowed for you yet. Tell the human to allow one under Settings → ' +
        'Supervisor, and do nothing else.';
  return [
    ROLE,
    '## Projects',
    'What you may use when you started. Call list_projects with `project` for the live state ' +
      'of a project: the policy, the running counts and the allowed models can change.',
    projectSection,
    '## Skills',
    describeSkills(skills, tools.length > 0),
    ...(tools.length > 0 ? ['## Tools', describeTools(tools)] : []),
    ...(chrome
      ? [
          '## Browser',
          "Claude in Chrome (`claude-in-chrome`) drives the human's own Chrome, logged-in " +
            'sessions included. Open new tabs for your work, never touch tabs you did not open, ' +
            'and never submit, buy, send or delete anything without the human saying so.',
        ]
      : []),
    '## Starting an agent',
    SPAWN_RULES,
    '## Nie blockierend warten',
    WAIT_RULES,
    '## Stalled agents',
    'At each check compare outputBytes and activity with the last check. After 15 minutes ' +
      '(or the configured interval) unchanged, without waiting for input or a running tool, ' +
      'the IDE nudges an interactive child once; never duplicate that nudge. For headless ' +
      'children read the output and decide. If still unchanged after another interval, ' +
      'escalate to the human; never repeat nudges or block on waits.',
    '## Working with your agents',
    CHILD_RULES,
    '## Cleaning up',
    CLEANUP_RULES,
    '## Supervisor link settings',
    LINK_POLICY_RULES,
    '## Reporting',
    REPORT,
    ...(instructions?.trim()
      ? ['## Instructions from the human', INSTRUCTIONS_PREAMBLE, instructions.trim()]
      : []),
    ...(resumedRun ? ['## Picking up an earlier run', describeResumedRun(resumedRun)] : []),
    ...(firstTask?.trim() ? ['## Your first task', firstTask.trim()] : []),
  ].join('\n\n');
}
