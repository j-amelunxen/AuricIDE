import type { ConnectorRegistration } from '@/lib/config/connectorPolicy';
import { invoke } from './invoke';

/** Reads an MCP connector's manifest at `path` so the owner can approve it. */
export async function inspectConnector(path: string): Promise<ConnectorRegistration> {
  return await invoke<ConnectorRegistration>('connector_inspect', { path });
}
