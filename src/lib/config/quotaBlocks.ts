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

export function isProviderFullyBlocked(
  blocks: readonly QuotaBlock[],
  provider: string,
  allowedModels: readonly string[],
  nowMs: number = Date.now()
): boolean {
  if (allowedModels.length === 0) return false;
  return allowedModels.every((model) => findBlockForModel(blocks, provider, model, nowMs) !== null);
}

export function formatScopeBadge(block: QuotaBlock): string {
  switch (block.scope.kind) {
    case 'provider':
      return `${block.provider} (all models)`;
    case 'family':
      return `${block.provider} ${block.scope.prefix}*`;
    case 'model':
      return `${block.provider} ${block.scope.model}`;
  }
}
