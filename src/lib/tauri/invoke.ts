type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Pulls `invoke` out of whatever shape the bundler left the Tauri module in.
 * A missing function is a real answer — browser mode, tests, a webview that
 * has not injected the IPC yet — and must not become `undefined(...)`.
 */
export function resolveTauriInvoke(mod: {
  invoke?: unknown;
  default?: { invoke?: unknown };
}): TauriInvoke | null {
  const candidate = mod.invoke ?? mod.default?.invoke;
  return typeof candidate === 'function' ? (candidate as TauriInvoke) : null;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const mod = await import('@tauri-apps/api/core');
  const tauriInvoke = resolveTauriInvoke(mod);
  if (!tauriInvoke) {
    throw new Error(`Tauri IPC is unavailable (${cmd})`);
  }
  return tauriInvoke<T>(cmd, args);
}
