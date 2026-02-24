export const GUIDANCE = {
  pm: {
    epic: 'Tickets must belong to an Epic, which represents a high-level feature or project goal.',
    status:
      'The current state of the ticket. Tickets move from Open to In Progress and finally to Done.',
    priority:
      'Indicates the urgency. Critical tasks block development, while Low tasks are nice-to-have improvements.',
    modelPower:
      'Choose the reasoning capability for the agent. High power models are better at complex logic but may be slower.',
    context: 'Additional files or information the agent needs to understand and complete the task.',
    testCases:
      'Specific requirements and checks that must pass for this ticket to be considered complete.',
    dependencies: 'Other tickets or epics that must be finished before this task can be started.',
    workingDirectory:
      'The folder where the agent will perform its work. Defaults to the project root.',
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
  },
  settings: {
    autoAcceptEdits: 'If enabled, the agent will apply file changes without asking for permission.',
    dangerouslyIgnorePermissions:
      'GRANT FULL ACCESS: The agent can execute any command and access any file. Use with extreme caution!',
    agenticCommit: 'Use an AI agent to automatically generate commit messages and push changes.',
    deepNlp:
      'Enables advanced natural language processing for the editor. Requires downloading ~300MB of models.',
    linting: 'Shows real-time warnings and errors for your Markdown files.',
  },
};
