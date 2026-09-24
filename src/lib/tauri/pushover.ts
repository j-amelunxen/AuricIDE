import { invoke } from './invoke';

/** Sends directly to Pushover; deliberately does not create an inbox row. */
export async function sendPushoverTest(): Promise<void> {
  await invoke('pushover_send_test');
}
