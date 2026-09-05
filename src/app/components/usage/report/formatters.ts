import type { UsageWindowId } from '@/lib/usage/ccUsage';

export const WINDOW_ORDER: UsageWindowId[] = ['24h', '3d', '7d', '30d'];

export function percent(share: number): string {
  if (share <= 0) return '0%';
  if (share < 0.001) return '<0.1%';
  return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

export function signedPercent(ratio: number): string {
  const magnitude = Math.abs(ratio);
  return `${ratio >= 0 ? '+' : '−'}${(magnitude * 100).toFixed(magnitude < 0.1 ? 1 : 0)}%`;
}

export function bucketLabel(startsAt: number, bucketSeconds: number): string {
  const at = new Date(startsAt * 1000);
  if (bucketSeconds >= 24 * 3600) {
    return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function intervalLabel(bucketSeconds: number): string {
  return bucketSeconds >= 86400 ? `${bucketSeconds / 86400} day` : `${bucketSeconds / 3600} h`;
}
