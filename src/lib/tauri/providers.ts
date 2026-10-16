export interface ModelOption {
  value: string;
  label: string;
  /**
   * Size within its provider, higher is bigger (1 small … 4 largest); absent or
   * `null` for a model without a known size (`dynamic-providers/README.md`).
   */
  rank?: number | null;
}

export interface PermissionModeOption {
  value: string;
  label: string;
  description: string;
  /** True when the mode skips permission prompts; Rust leaves it out when false. */
  unattended?: boolean;
}

import { invoke } from './invoke';

export interface ProviderInfo {
  id: string;
  name: string;
  models: ModelOption[];
  permissionModes: PermissionModeOption[];
  defaultModel: string;
  defaultPermissionMode: string;
}

export async function listProviders(): Promise<ProviderInfo[]> {
  return await invoke<ProviderInfo[]>('list_providers');
}

/** Import a dynamic provider config (JSON) at runtime; returns the imported provider. */
export async function importProvider(json: string): Promise<ProviderInfo> {
  return await invoke<ProviderInfo>('import_provider', { json });
}

export async function getPromptTemplate(providerId?: string): Promise<string> {
  const result = await invoke<{ template: string }>('get_prompt_template', {
    providerId: providerId ?? null,
  });
  return result.template;
}

// ── Fallback defaults for browser mode ─────────────────────────────

export const FALLBACK_CRUSH_PROVIDER: ProviderInfo = {
  id: 'crush',
  name: 'Crush',
  models: [
    { value: 'auto', label: 'Auto / Default' },
    { value: 'moonshotai/kimi-k2-thinking', label: 'Moonshot Kimi k2 Thinking' },
  ],
  permissionModes: [
    {
      value: 'yolo',
      label: 'Act without asking',
      description: 'Skip all permission prompts (--yolo)',
    },
    { value: 'default', label: 'Interactive', description: 'Ask for permissions' },
  ],
  defaultModel: 'auto',
  defaultPermissionMode: 'default',
};

export const FALLBACK_PROMPT_TEMPLATE = 'crush "';
