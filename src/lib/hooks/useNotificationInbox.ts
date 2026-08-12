import { useEffect } from 'react';
import { useStore } from '../store';
import { onNotificationsChanged } from '../tauri/notifications';

/**
 * Keeps the notification inbox in step with the database.
 *
 * Three triggers, because one is not enough:
 *
 * - **On mount**, a full load. The inbox is app-global, so it does not depend
 *   on which project is open and does not reload when that changes.
 * - **On `notifications-changed`**, a drain from the cursor. This is the only
 *   channel through which writes from another process — the MCP server, a
 *   second app instance — arrive.
 * - **On window focus**, another drain. A file event can be missed, and the
 *   failure mode is silent: a list that is quietly behind. Coming back to the
 *   window is exactly the moment you would trust what it shows, so re-check
 *   there rather than polling on a timer.
 */
export function useNotificationInbox(): void {
  const reloadNotifications = useStore((s) => s.reloadNotifications);
  const drainNotifications = useStore((s) => s.drainNotifications);

  useEffect(() => {
    void reloadNotifications();
  }, [reloadNotifications]);

  useEffect(() => onNotificationsChanged(() => void drainNotifications()), [drainNotifications]);

  useEffect(() => {
    const onFocus = () => void drainNotifications();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [drainNotifications]);
}
