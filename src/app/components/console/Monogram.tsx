export interface MonogramProps {
  /** Two letters from `agentMonogram` — this component draws them, it doesn't derive them. */
  monogram: string;
  /** The agent's identity colour — the marker if the user set one, else an auto-assigned hue. */
  color: string;
}

/**
 * A lane's identity badge: two letters on a 20% tint of the agent's colour.
 * Decorative — the agent's name always sits right next to it in the feed and
 * the rail, so this never needs its own accessible name.
 */
export function Monogram({ monogram, color }: MonogramProps) {
  return (
    <span
      aria-hidden="true"
      data-testid="feed-agent-mark"
      style={{ backgroundColor: `${color}33`, color }}
      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
    >
      {monogram}
    </span>
  );
}
