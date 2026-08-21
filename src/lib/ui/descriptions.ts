export const GUIDANCE = {
  pm: {
    epic: 'Tickets must belong to an Epic, which represents a high-level feature or project goal.',
    status:
      'The current state of the ticket. Work moves Open → In Progress → To Test → Review → Done. Discarded tickets leave the board like archived ones.',
    priority:
      'Indicates the urgency. Critical tasks block development, while Low tasks are nice-to-have improvements.',
    modelPower:
      'Choose the reasoning capability for the agent. High power models are better at complex logic but may be slower.',
    context: 'Additional files or information the agent needs to understand and complete the task.',
    testCases:
      'Specific requirements and checks that must pass for this ticket to be considered complete.',
    dependencies: 'Other tickets or epics that must be finished before this task can be started.',
    workingDirectory:
      'The folder where the agent will perform its work. Defaults to the project root. Quick Access pins can send the same setup to several projects at once.',
    skills:
      'Project or personal skills written in front of the agent prompt when this ticket is launched.',
    epicName: 'A clear name for the high-level goal or feature set.',
    epicDescription: 'Detailed breakdown of what this Epic aims to achieve and its overall scope.',
  },
  agents: {
    task: 'A clear and detailed instruction of what the agent should accomplish.',
    provider: 'The LLM service provider used to run the agent.',
    model: 'The specific intelligence model. Better models handle complex tasks more reliably.',
    permissionMode:
      "Defines the agent's autonomy. 'Auto-approve' lets it run freely, 'Ask' requires your confirmation for changes.",
    headless:
      'If enabled, the agent runs in the background without a terminal interface and exits automatically.',
    worktree:
      'Checks the agent out onto a new git branch in a sibling folder, so it cannot dirty your current files. If this folder is not itself a git repo, you choose which nested repo to branch. When the agent ends you can merge that branch into main or master, which also removes the worktree.',
    worktreeRepo:
      'This folder contains git repositories in subfolders. Choose which one the agent should check out into a worktree.',
  },
  settings: {
    autoAcceptEdits: 'If enabled, the agent will apply file changes without asking for permission.',
    dangerouslyIgnorePermissions:
      'Skips permission prompts. The agent can run commands and access files without asking. Use only for work you trust.',
    agenticCommit:
      'Use an AI agent to write the commit. Push is a separate click — Commit stays local, Commit & Push publishes.',
    deepNlp:
      'Enables advanced natural language processing for the editor. Requires downloading ~300MB of models.',
    linting: 'Shows real-time warnings and errors for your Markdown files.',
    cliUsageLimits:
      'Shows remaining usage and reset times. Claude updates while its interactive agent runs; Codex updates every 15 minutes, or when you refresh.',
    agentConsoleAutoOpen:
      'When no project is open and agents are running, shows the Agent Console instead of the start screen.',
  },
};
