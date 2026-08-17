import { FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '@/lib/tauri/providers';
import type { PermissionMode } from '@/lib/tauri/agents';

/** The part of a launch a skill may pin, in the shape every caller stores it. */
export interface SkillLaunchPins {
  providerId?: string;
  model?: string;
  permissionMode?: PermissionMode;
}

export interface SkillLaunchChoice {
  provider: string;
  model: string;
  permissionMode: PermissionMode;
}

/**
 * Turns a skill's pinned choices into the three values a spawn needs.
 *
 * One definition for every path that starts a pinned skill without the dialog —
 * a combo step and a notification's Start button. Two copies would let the same
 * skill run under different permissions depending on which button was pressed,
 * and that difference would be invisible at the button.
 *
 * A pinned provider that no longer exists falls back to the first one the
 * machine offers rather than failing: the harness list is a property of the
 * machine, and a skill pinned on another one must still be startable. Model and
 * permission mode then come from that provider's own defaults, because a model
 * name only means something relative to the provider it was pinned for.
 */
export function resolveSkillLaunch(
  pins: SkillLaunchPins,
  providers: ProviderInfo[]
): SkillLaunchChoice {
  const named = pins.providerId
    ? providers.find((provider) => provider.id === pins.providerId)
    : undefined;
  const provider = named ?? providers[0] ?? FALLBACK_CRUSH_PROVIDER;
  // A pinned provider that is gone takes its model and permission mode with it:
  // both name something inside that one harness, and carried onto a different
  // one they would either be rejected or mean something else.
  const stale = pins.providerId !== undefined && named === undefined;

  return {
    provider: provider.id,
    model: (stale ? undefined : pins.model) || provider.defaultModel,
    permissionMode: ((stale ? undefined : pins.permissionMode) ??
      provider.defaultPermissionMode) as PermissionMode,
  };
}
