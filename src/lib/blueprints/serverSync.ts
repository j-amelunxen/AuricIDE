import type { Blueprint } from '../tauri/blueprints';

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'unreachable';

export interface SyncResult {
  addedLocally: Blueprint[];
  pushedToServer: Blueprint[];
}

export async function fetchServerBlueprints(url: string): Promise<Blueprint[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${url}/api/blueprints`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    return (await res.json()) as Blueprint[];
  } finally {
    clearTimeout(timer);
  }
}

export async function pushToServer(url: string, blueprints: Blueprint[]): Promise<void> {
  const res = await fetch(`${url}/api/blueprints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(blueprints),
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
}

export async function syncWithServer(
  url: string,
  localBlueprints: Blueprint[],
): Promise<SyncResult> {
  const serverBlueprints = await fetchServerBlueprints(url);
  const localIds = new Set(localBlueprints.map((b) => b.id));
  const serverIds = new Set(serverBlueprints.map((b) => b.id));

  const addedLocally = serverBlueprints.filter((b) => !localIds.has(b.id));
  const pushedToServer = localBlueprints.filter((b) => !serverIds.has(b.id));

  if (pushedToServer.length > 0) {
    await pushToServer(url, pushedToServer);
  }

  return { addedLocally, pushedToServer };
}
