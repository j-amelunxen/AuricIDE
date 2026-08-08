/**
 * Colours a person can put on an agent to group or mark it — the fleet
 * equivalent of a Finder tag. Deliberately few and deliberately obvious: the
 * value is in telling them apart at a glance across a scrolling list, which
 * more shades would destroy.
 */
export type AgentColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';

export interface AgentColorOption {
  key: AgentColor;
  label: string;
  /** Explicit hex rather than a theme token: these must stay recognisable as
   * "the red one" regardless of the accent colour the user picked. */
  hex: string;
}

export const AGENT_COLORS: AgentColorOption[] = [
  { key: 'red', label: 'Red', hex: '#ff6b6b' },
  { key: 'orange', label: 'Orange', hex: '#ff9f43' },
  { key: 'yellow', label: 'Yellow', hex: '#f7d154' },
  { key: 'green', label: 'Green', hex: '#4ade80' },
  { key: 'blue', label: 'Blue', hex: '#4aa8ff' },
  { key: 'purple', label: 'Purple', hex: '#a882ff' },
];

const BY_KEY = new Map(AGENT_COLORS.map((c) => [c.key, c]));

/** The hex for a marker colour, or null when the agent carries no marker. */
export function agentColorHex(color: AgentColor | undefined | null): string | null {
  if (!color) return null;
  return BY_KEY.get(color)?.hex ?? null;
}

export function agentColorLabel(color: AgentColor | undefined | null): string | null {
  if (!color) return null;
  return BY_KEY.get(color)?.label ?? null;
}
