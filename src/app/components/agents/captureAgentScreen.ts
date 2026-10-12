import { writeFile } from '@/lib/tauri/fs';
import { saveTerminalScreen } from '@/lib/scratch/fromTerminal';
import { useStore } from '@/lib/store';

function toastScreenSave(
  result: Awaited<ReturnType<typeof saveTerminalScreen>> | 'opening' | 'failed'
): void {
  const toast = useStore.getState().showToast;
  if (result === 'opening') {
    toast('The terminal is still opening', 'info');
    return;
  }
  if (result === 'failed') {
    toast('Could not save the screen', 'error');
    return;
  }
  if (result.ok) {
    toast(`Screen saved as ${result.name}`, 'success');
    return;
  }
  toast(
    result.reason === 'empty'
      ? 'Nothing on the screen to save'
      : 'Could not resolve the scratch directory',
    result.reason === 'empty' ? 'info' : 'error'
  );
}

async function resolveScratchDir(): Promise<string | null> {
  let dir = useStore.getState().scratchDir;
  if (!dir) {
    await useStore.getState().initScratches();
    dir = useStore.getState().scratchDir;
  }
  return dir;
}

/**
 * Saves what a terminal shows as a scratch and says how it went. Main window
 * only: the scratch folder belongs to the store that has the project.
 * `readScreen` answers null while the terminal is still opening.
 */
export async function captureAgentScreen(
  agentName: string,
  readScreen: () => string | null
): Promise<void> {
  try {
    const screen = readScreen();
    if (screen === null) {
      toastScreenSave('opening');
      return;
    }
    const result = await saveTerminalScreen({
      agentName,
      screen,
      resolveDir: resolveScratchDir,
      existingNames: () => useStore.getState().scratches.map((scratch) => scratch.name),
      write: writeFile,
      refresh: () => useStore.getState().refreshScratches(),
    });
    toastScreenSave(result);
  } catch {
    toastScreenSave('failed');
  }
}
