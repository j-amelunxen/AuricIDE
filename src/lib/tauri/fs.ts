import { invoke } from './invoke';

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  createdAt?: number;
  newestFileCreatedAt?: number;
}

interface RawFileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  created_at?: number | null;
  newest_file_created_at?: number | null;
}

export async function readDirectory(path: string): Promise<FileEntry[]> {
  const entries = await invoke<RawFileEntry[]>('read_directory', { path });
  return entries.map((e) => ({
    name: e.name,
    path: e.path,
    isDirectory: e.is_directory,
    createdAt: e.created_at ?? undefined,
    newestFileCreatedAt: e.newest_file_created_at ?? undefined,
  }));
}

export async function exists(path: string): Promise<boolean> {
  return await invoke<boolean>('exists', { path });
}

/** True only when path is an existing directory, not a file. */
export async function isDir(path: string): Promise<boolean> {
  return await invoke<boolean>('is_dir', { path });
}

export async function readFile(path: string): Promise<string> {
  return await invoke<string>('read_file', { path });
}

export async function readFileBase64(path: string): Promise<string> {
  return await invoke<string>('read_file_base64', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  await invoke('write_file', { path, content });
}

export async function copyFile(source: string, destination: string): Promise<void> {
  await invoke('copy_file', { source, destination });
}

export async function deleteFile(path: string): Promise<void> {
  await invoke('delete_file', { path });
}

export async function createDirectory(path: string): Promise<void> {
  await invoke('create_directory', { path });
}

/** Move a file or directory to a new absolute path (explorer drag-and-drop). */
export async function movePath(source: string, destination: string): Promise<void> {
  await invoke('move_path', { source, destination });
}

export interface ProjectFileInfo {
  path: string;
  extension: string;
  line_count: number;
}

export async function getProjectFilesInfo(rootPath: string): Promise<ProjectFileInfo[]> {
  return await invoke<ProjectFileInfo[]>('get_project_files_info', { rootPath });
}

export async function listAllFiles(rootPath: string): Promise<string[]> {
  return await invoke<string[]>('list_all_files', { rootPath });
}

export async function openFolderDialog(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Open Project Folder',
  });
  return selected as string | null;
}
