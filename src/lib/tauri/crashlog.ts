export interface FrontendError {
  message: string;
  source: string | null;
  lineno: number | null;
  colno: number | null;
  stack: string | null;
  componentStack: string | null;
  errorType: string;
}

export interface CrashLogEntry {
  filename: string;
  timestamp: number;
  sizeBytes: number;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

export async function reportFrontendCrash(error: FrontendError): Promise<string> {
  return await invoke<string>('report_frontend_crash', { error });
}

export async function listCrashLogs(): Promise<CrashLogEntry[]> {
  return await invoke<CrashLogEntry[]>('list_crash_logs');
}

export async function readCrashLog(filename: string): Promise<string> {
  return await invoke<string>('read_crash_log', { filename });
}
