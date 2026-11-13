export interface LogEntry {
  tab: string;
  text: string;
  timestamp: number;
  agentId?: string;
}

export interface ExtraTerminal {
  id: string;
  label: string;
  cwd: string;
}
