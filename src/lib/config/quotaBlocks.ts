/**
 * Provider & model-family quota blocks: the types and matching rules of
 * `src-tauri/src/quota_blocks`, tested against the same fixtures.
 *
 * `supervisorPolicy.ts` uses them in its twin of the spawn check. No screen shows
 * blocks yet, and nothing loads them from Rust; Rust decides on its own file.
 */

export type QuotaBlockScope =
  { kind: 'provider' } | { kind: 'family'; prefix: string } | { kind: 'model'; model: string };

export type QuotaBlockReason =
  'quota_exhausted' | 'rate_limited' | 'silent_model_fallback' | 'manual';

export interface QuotaBlock {
  id: string;
  provider: string;
  scope: QuotaBlockScope;
  reason: QuotaBlockReason;
  detail: string;
  detectedAt: string;
  expiresAt: string;
  sourceAgentId?: string;
}

export function isBlockActive(block: QuotaBlock, nowMs: number = Date.now()): boolean {
  const expiresMs = Date.parse(block.expiresAt);
  return !Number.isNaN(expiresMs) && expiresMs > nowMs;
}

export function blockMatchesModel(block: QuotaBlock, provider: string, model: string): boolean {
  if (block.provider.trim().toLowerCase() !== provider.trim().toLowerCase()) {
    return false;
  }
  switch (block.scope.kind) {
    case 'provider':
      return true;
    case 'family':
      return model.toLowerCase().startsWith(block.scope.prefix.toLowerCase());
    case 'model':
      return model === block.scope.model;
  }
}

export function findBlockForModel(
  blocks: readonly QuotaBlock[],
  provider: string,
  model: string,
  nowMs: number = Date.now()
): QuotaBlock | null {
  let latest: QuotaBlock | null = null;
  for (const block of blocks) {
    if (!isBlockActive(block, nowMs)) continue;
    if (!blockMatchesModel(block, provider, model)) continue;
    if (!latest || Date.parse(block.expiresAt) > Date.parse(latest.expiresAt)) {
      latest = block;
    }
  }
  return latest;
}
