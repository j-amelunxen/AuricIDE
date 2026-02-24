import { invoke } from './invoke';

export interface KvEntry {
  namespace: string;
  key: string;
  value: string;
  updated_at: string;
}

export async function initProjectDb(projectPath: string): Promise<void> {
  await invoke('init_project_db', { projectPath });
}

export async function dbGet(
  projectPath: string,
  namespace: string,
  key: string
): Promise<string | null> {
  return await invoke<string | null>('db_get', { projectPath, namespace, key });
}

export async function dbSet(
  projectPath: string,
  namespace: string,
  key: string,
  value: string
): Promise<void> {
  await invoke('db_set', { projectPath, namespace, key, value });
}

export async function dbDelete(
  projectPath: string,
  namespace: string,
  key: string
): Promise<boolean> {
  return await invoke<boolean>('db_delete', { projectPath, namespace, key });
}

export async function dbList(projectPath: string, namespace: string): Promise<KvEntry[]> {
  return await invoke<KvEntry[]>('db_list', { projectPath, namespace });
}

export async function closeProjectDb(projectPath: string): Promise<void> {
  await invoke('close_project_db', { projectPath });
}

export async function exportDatabase(projectPath: string, destinationPath: string): Promise<void> {
  await invoke('db_export', { projectPath, destinationPath });
}

export async function importDatabase(projectPath: string, sourcePath: string): Promise<void> {
  await invoke('db_import', { projectPath, sourcePath });
}
