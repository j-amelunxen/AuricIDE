import { CREDENTIAL_NAMESPACES } from '@/lib/tauri/appCredentials';

export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  hint?: string;
}

export interface CredentialGroup {
  namespace: string;
  title: string;
  icon: string;
  blurb: string;
  fields: CredentialField[];
  toggles?: { key: string; label: string; description: string; defaultOn: boolean }[];
}

/** The judge talks to a model the same way the LLM does, so it is configured the same way. */
const CHAT_MODEL_SETTINGS: Pick<CredentialGroup, 'fields' | 'toggles'> = {
  fields: [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://openrouter.ai/api/v1' },
    { key: 'api_key', label: 'API Key', secret: true },
    { key: 'model', label: 'Model', placeholder: 'moonshotai/kimi-k2-thinking' },
  ],
  toggles: [
    {
      key: 'reasoning_enabled',
      label: 'Reasoning',
      description: 'Send the reasoning extension (OpenRouter only)',
      defaultOn: true,
    },
  ],
};

/**
 * Every credential namespace as one group: the application screen edits all of
 * it, a project's override screen the fields (toggles are machine-wide only).
 */
export const CREDENTIAL_GROUPS: Record<
  'llm' | 'judge' | 'excalidraw' | 'videoImport',
  CredentialGroup
> = {
  llm: {
    namespace: CREDENTIAL_NAMESPACES.llm,
    title: 'LLM',
    icon: 'psychology',
    blurb: 'The model behind analysis, generation and the conductor.',
    ...CHAT_MODEL_SETTINGS,
  },
  judge: {
    namespace: CREDENTIAL_NAMESPACES.judge,
    title: 'Judge',
    icon: 'gavel',
    blurb: 'A second model that reviews claimed work. Independent of the one that built it.',
    ...CHAT_MODEL_SETTINGS,
  },
  excalidraw: {
    namespace: CREDENTIAL_NAMESPACES.excalidraw,
    title: 'Excalidraw+',
    icon: 'draw',
    blurb: 'Read scenes and collections from an Excalidraw+ workspace.',
    fields: [{ key: 'api_key', label: 'API Key', secret: true }],
  },
  videoImport: {
    namespace: CREDENTIAL_NAMESPACES.videoImport,
    title: 'Video Import',
    icon: 'video_file',
    blurb: 'Where narrated recordings get transcribed.',
    fields: [
      { key: 'remote_endpoint', label: 'Remote Endpoint' },
      { key: 'remote_api_key', label: 'Remote API Key', secret: true },
      {
        key: 'remote_model',
        label: 'Remote Model',
        placeholder: 'nvidia/parakeet-tdt-0.6b-v3',
      },
      { key: 'local_command', label: 'Local Command', placeholder: 'parakeet-mlx' },
    ],
  },
};
