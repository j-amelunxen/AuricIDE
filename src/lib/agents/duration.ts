/**
 * A short age for an agent, sized for a badge. Unlike the PM formatter this
 * one counts seconds: for a fleet, the first half-minute of silence is exactly
 * the interval you are reading, and "< 1m" throws it away.
 */
export function formatAgentDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
