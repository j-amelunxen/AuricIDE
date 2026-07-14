/**
 * Opens an external URL in the system browser via tauri-plugin-opener.
 * Falls back to copying the URL to the clipboard (browser mode / plugin
 * missing) and reports that via the thrown error message.
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    await navigator.clipboard.writeText(url);
    throw new Error('Could not open the browser — link copied to clipboard instead');
  }
}

/** Reveals `path` in the OS file manager (Finder / Explorer / file manager) via tauri-plugin-opener. */
export async function revealInFileManager(path: string): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}
