'use client';

import { CredentialOverride } from './CredentialOverride';
import { CREDENTIAL_NAMESPACES } from '@/lib/tauri/appCredentials';

/**
 * The project's LLM overrides. The values themselves live under
 * Application → Credentials — a key is a property of this machine, not of one
 * repository, and typing it again per project was the thing worth removing.
 */
export function LlmContent() {
  return (
    <CredentialOverride
      namespace={CREDENTIAL_NAMESPACES.llm}
      title="LLM"
      icon="psychology"
      blurb="The model behind analysis, generation and the conductor."
      fields={[
        { key: 'base_url', label: 'Base URL', placeholder: 'https://openrouter.ai/api/v1' },
        { key: 'api_key', label: 'API Key', secret: true },
        { key: 'model', label: 'Model', placeholder: 'moonshotai/kimi-k2-thinking' },
      ]}
    />
  );
}
