import type { VisibleProject } from '@/lib/config/supervisorPolicy';
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
          return { id, label: option?.label ?? id, rank: option?.rank ?? null };
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

function describeSkills(skills: SupervisorPromptSkill[]): string {
  if (skills.length === 0) {
    return 'No skill is approved for you, and you have no shell. Settings → Supervisor approves skills.';
  }
  const lines = skills.map((skill) =>
    skill.bash.length > 0
      ? `- \`/${skill.name}\` — shell commands it may run: ${skill.bash.map((p) => `\`${p}\``).join(', ')}`
      : `- \`/${skill.name}\` — no shell`
  );
  return [
    ...lines,
    'A shell command outside these patterns is refused. A skill that needs one is work for an ' +
      'agent you start.',
  ].join('\n');
}

function describeModel(model: SupervisorPromptModel): string {
  const label = model.label && model.label !== model.id ? ` (${model.label})` : '';
  return `\`${model.id}\`${label} — ${modelSizeLabel(model.rank)}`;
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
    for (const model of byRank(provider.models)) lines.push(`  - ${describeModel(model)}`);
  }
  return lines.join('\n');
}

const SPAWN_RULES = [
  'Before every spawn_agent call, state one line: which project, headless or interactive, ' +
    'which model, and why that model.',
  '- **An answer you need** (a question, a check, a short fix with a verdict): ' +
    '`headless: true`, then call await_agent_result until done is true.',
  '- **Long-running or multi-step work, or work a human may need to answer**: ' +
    '`headless: false`, only where interactive runs are allowed. Report the agent id and do ' +
    'not wait on it.',
  '- **Provider: follow the load balancing.** Where a project has it, take the provider ' +
    'list_projects names as `balancing.next`. Take another one only when that provider has no ' +
    'model the task needs, and say why in your spawn line.',
  '- **Model: the smallest allowed one that fits.** Trivial → small, normal work → medium, ' +
    'hard reasoning or architecture → large. Use the largest only with a stated reason. Never ' +
    'pick a model of unknown size unless nothing else is allowed.',
  '- A refused spawn (supervisor_denied, provider_denied) is an answer: report it with its ' +
    'reason. Never switch provider or model to get around it.',
].join('\n');

const CHILD_RULES = [
  '- **Child prompts stand alone.** The agent cannot see this conversation: give it the goal, ' +
    'the context it needs and what done means. End every child prompt with: "Finish with one ' +
    'line starting with ANSWER: that states the result."',
  '- **You cannot type into an agent.** When one waits on a question, tell the human which ' +
    "agent's window to answer in (its name and id), then carry on.",
].join('\n');

const REPORT =
  'Report per agent: id, project, model, and its result (the ANSWER line, or why there is ' +
  'none). Keep the human informed; do not invent results you have not read.';

/**
 * The supervisor's start instruction for the projects its policy shows. A
 * skill launched from the tile adds its prompt as the first task, after the
 * rules, so the rules are read before the work is.
 */
export function buildSupervisorLaunchPrompt(
  projects: SupervisorPromptProject[],
  firstTask?: string,
  skills: SupervisorPromptSkill[] = [],
  chrome = false
): string {
  const projectSection =
    projects.length > 0
      ? projects.map(describeProject).join('\n\n')
      : 'No project is allowed for you yet. Tell the human to allow one under Settings → ' +
        'Supervisor, and do nothing else.';
  return [
    ROLE,
    '## Projects',
    'What you may use when you started. Call list_projects for the live state: the policy, ' +
      'the running counts and the allowed models can change.',
    projectSection,
    '## Skills',
    describeSkills(skills),
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
    '## Working with your agents',
    CHILD_RULES,
    '## Reporting',
    REPORT,
    ...(firstTask?.trim() ? ['## Your first task', firstTask.trim()] : []),
  ].join('\n\n');
}
