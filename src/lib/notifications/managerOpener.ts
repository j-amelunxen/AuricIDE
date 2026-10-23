import { openManager } from '@/lib/agents/openSupervisor';
import type { StoreState } from '@/lib/store';
import type { NotificationActionDeps } from './execute';

/**
 * The `openManager` dependency of `executeNotificationAction`, for the click
 * and the automatic start alike. `show` is the difference: a click selects the
 * manager's terminal, an automatic start (`show: false`) must not take the
 * screen from whatever the user is looking at ("started means visible, on a
 * click"). It also sends the task as automatic text and opens no dialog, so it
 * can come back `declined` (the human is typing there, or a provider choice
 * would be needed) and then does nothing at all.
 *
 * The store is read at the moment of the call: whether the manager runs is
 * decided from the fleet as it is then, not as it was when the row arrived.
 */
export function managerOpener(
  getStore: () => StoreState,
  { show }: { show: boolean }
): NotificationActionDeps['openManager'] {
  return (managerKey, options) => {
    const store = getStore();
    return openManager(
      store,
      managerKey,
      {
        // The toast says what is missing; there is no Settings page to jump to from a reminder.
        onNothingVisible: () => undefined,
        onShow: show ? store.selectAgent : () => undefined,
      },
      { ...options, automatic: !show }
    );
  };
}
