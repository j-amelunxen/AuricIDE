import { agentColorHex, type AgentColor } from './colors';

/**
 * Identity colours for reading a merged stream — which agent is talking right
 * now, answered by hue rather than by parsing the name on every line.
 *
 * Deliberately **not** `AGENT_COLORS`. That palette is the user's marker, put
 * on an agent on purpose; these are assigned automatically and mean nothing
 * beyond "a different agent". Keeping them separate is what stops an
 * auto-assigned tint from reading as a marker somebody chose.
 *
 * None of these is the status palette's emerald, amber, red or accent: status
 * owns those, and an identity hue landing on one of them would make a calm
 * agent's name read as an alarm.
 */
export const STREAM_COLORS: readonly string[] = [
  '#56ccf2', // sky
  '#a78bfa', // violet
  '#e879f9', // fuchsia
  '#2dd4bf', // teal
  '#818cf8', // indigo
  '#a3e635', // lime
  '#fb923c', // orange
  '#f472b6', // pink
];

/**
 * A small, stable, order-independent hash of an agent id.
 *
 * Stability is the whole point: the colour must survive a re-render, a
 * re-sort of the fleet and a restart, because a stream whose colours shuffle
 * is worse than one with no colours at all. So this hashes the id rather than
 * handing out palette slots by arrival order.
 */
function hashAgentId(agentId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < agentId.length; i++) {
    hash ^= agentId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The colour an agent's lines are tinted with in a merged stream. A marker
 * the user set wins — they picked it precisely so that agent stands out, and
 * an automatic hue overriding that choice would defeat it.
 */
export function streamColorFor(agentId: string, marker?: AgentColor | null): string {
  const chosen = agentColorHex(marker);
  if (chosen) return chosen;
  return STREAM_COLORS[hashAgentId(agentId) % STREAM_COLORS.length];
}

/**
 * Colours for a set of agents that have to be told apart at a glance — the
 * tabs and panes of the terminal. Two agents sharing a hue there would
 * defeat the point, so a collision moves the later agent to the next free
 * palette slot instead of keeping its hash.
 *
 * Markers are placed first and keep their hue, which no one else then takes.
 * The rest are handled in hash order, not in the order given, so the answer
 * does not depend on how the fleet happens to be listed. With more agents
 * than hues the surplus fall back to their own hash colour.
 */
export function distinctStreamColors(
  agentIds: readonly string[],
  markers: Readonly<Record<string, AgentColor | undefined>>
): Record<string, string> {
  const colors: Record<string, string> = {};
  const taken = new Set<string>();
  const unmarked: string[] = [];
  for (const id of agentIds) {
    const chosen = agentColorHex(markers[id]);
    if (chosen) {
      colors[id] = chosen;
      taken.add(chosen);
    } else {
      unmarked.push(id);
    }
  }
  unmarked.sort((a, b) => hashAgentId(a) - hashAgentId(b) || a.localeCompare(b));
  for (const id of unmarked) {
    const wanted = hashAgentId(id) % STREAM_COLORS.length;
    const free = STREAM_COLORS.map(
      (_, step) => STREAM_COLORS[(wanted + step) % STREAM_COLORS.length]
    ).find((hex) => !taken.has(hex));
    colors[id] = free ?? STREAM_COLORS[wanted];
    taken.add(colors[id]);
  }
  return colors;
}
