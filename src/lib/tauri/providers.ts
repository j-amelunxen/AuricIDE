export interface ModelOption {
  value: string;
  label: string;
}

export interface PermissionModeOption {
  value: string;
  label: string;
  description: string;
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
