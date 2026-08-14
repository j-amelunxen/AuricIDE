'use client';

import { CredentialOverride } from './CredentialOverride';
import { CREDENTIAL_NAMESPACES } from '@/lib/tauri/appCredentials';

/** The project's judge overrides; the values live under Application → Credentials. */
export function JudgeLlmContent() {
  return (
    <CredentialOverride
      namespace={CREDENTIAL_NAMESPACES.judge}
      title="Judge"
      icon="gavel"
      blurb="A second model that reviews claimed work, independent of the one that built it."
      fields={[
        { key: 'base_url', label: 'Base URL', placeholder: 'https://openrouter.ai/api/v1' },
        { key: 'api_key', label: 'API Key', secret: true },
        { key: 'model', label: 'Model', placeholder: 'moonshotai/kimi-k2-thinking' },
      ]}
    />
  );
}
