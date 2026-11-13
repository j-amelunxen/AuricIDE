import { invoke } from './invoke';
import { subscribeToTauriEvent } from './subscribe';

export const UI_PING_EVENT = 'ui-ping';

/** The Rust watchdog's ping; answered with {@link answerUiPing}. */
export function onUiPing(onPing: () => void): () => void {
  return subscribeToTauriEvent<unknown>(UI_PING_EVENT, () => onPing(), 'UI watchdog unavailable');
}

export async function answerUiPing(visible: boolean): Promise<void> {
  await invoke('ui_pong', { visible });
}

/** Appends one stall report line to `freezes.jsonl`. */
export async function recordUiStall(line: string): Promise<void> {
  await invoke('record_ui_stall', { line });
}
