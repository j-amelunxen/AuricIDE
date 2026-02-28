import type { PmDependency } from '../tauri/pm';

/**
 * Calculates the 'heat' of a ticket based on how many other items (epics or tickets)
 * depend on it. A ticket is 'hot' if it's a bottleneck.
 */
export function calculateHeat(ticketId: string, dependencies: PmDependency[]): number {
  return dependencies.filter((dep) => dep.targetType === 'ticket' && dep.targetId === ticketId)
    .length;
}

/**
 * Maps a heat value to a CSS class set for styling badges or nodes.
 * @param heat Number of incoming dependencies
 */
export function getHeatStyles(heat: number): string {
  if (heat === 0) {
    return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
  }
  if (heat <= 2) {
    return 'bg-green-500/10 text-green-400 border-green-500/20';
  }
  if (heat <= 4) {
    return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
  }
  if (heat <= 9) {
    return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
  }
  return 'bg-red-500/10 text-red-400 border-red-500/20';
}
