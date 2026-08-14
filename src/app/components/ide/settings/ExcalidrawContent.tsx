'use client';

import { CredentialOverride } from './CredentialOverride';
import { CREDENTIAL_NAMESPACES } from '@/lib/tauri/appCredentials';

/** The project's Excalidraw+ override; the key lives under Application → Credentials. */
export function ExcalidrawContent() {
  return (
    <CredentialOverride
      namespace={CREDENTIAL_NAMESPACES.excalidraw}
      title="Excalidraw+"
      icon="draw"
      blurb="Read scenes and collections from an Excalidraw+ workspace."
      fields={[{ key: 'api_key', label: 'API Key', secret: true }]}
    />
  );
}
