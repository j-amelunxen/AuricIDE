/**
 * One place that knows how to listen to a Tauri event safely.
 *
 * Two things make this non-trivial, and both are easy to get wrong per call
 * site: the module has to be imported lazily so the app still runs in a
 * browser or a test without a Tauri backend, and that lazy import means a
 * caller can unsubscribe before `listen` has even resolved. Subscribing then
 * returns a listener nobody holds — one that keeps firing for the rest of the
 * session.
 */
export function subscribeToTauriEvent<T>(
  eventName: string,
  callback: (payload: T) => void,
  unavailableWarning: string
): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;

  import('@tauri-apps/api/event')
    .then(({ listen }) => {
      if (disposed) return;
      if (typeof listen !== 'function') {
        console.warn(unavailableWarning);
        return;
      }
      // Returned so a rejected `listen` is the same path as a failed import —
      // otherwise the inner promise is nobody's and the Next overlay claims it.
      return listen<T>(eventName, (event) => {
        callback(event.payload);
      }).then((fn) => {
        // The caller may have unsubscribed while `listen` was in flight;
        // dropping the handle here instead would leak the listener.
        if (disposed) {
          try {
            fn();
          } catch {
            /* already unregistered */
          }
        } else {
          unlisten = fn;
        }
      });
    })
    .catch(() => {
      console.warn(unavailableWarning);
    });

  return () => {
    if (disposed) return;
    disposed = true;
    if (unlisten) {
      try {
        unlisten();
      } catch {
        // Listener may already have been unregistered by Tauri
      }
      unlisten = null;
    }
  };
}
