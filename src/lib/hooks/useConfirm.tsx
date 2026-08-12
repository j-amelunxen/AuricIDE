'use client';

import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog } from '@/app/components/ui/ConfirmDialog';

export interface ConfirmRequest {
  title: string;
  message: string;
  /** Label on the destructive button. Name the act, not "OK". */
  confirmLabel?: string;
}

export interface UseConfirmResult {
  /** Resolves true only after the user confirms; false on cancel or Escape. */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  /** Render this in the component's tree — the dialog lives here. */
  confirmDialog: React.ReactNode;
}

/**
 * Asks the user a yes/no question and waits for the answer.
 *
 * The browser's `window.confirm` cannot be used for this in AuricIDE: inside
 * the Tauri webview it shows its dialog without suspending JavaScript, so
 * `if (confirm(...)) { destroy() }` destroys first and asks afterwards — the
 * click the user makes never reaches the decision. Every gate in the app goes
 * through this hook instead, where the promise is the gate and the only thing
 * that can settle it is the user.
 */
export function useConfirm(): UseConfirmResult {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolveRef = useRef<((answer: boolean) => void) | null>(null);

  const settle = useCallback((answer: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    resolve?.(answer);
  }, []);

  const confirm = useCallback((next: ConfirmRequest) => {
    // A question that gets replaced was never answered — say so, rather than
    // leaving the earlier caller awaiting a promise that can no longer settle.
    resolveRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setRequest(next);
    });
  }, []);

  const confirmDialog = request ? (
    <ConfirmDialog
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel ?? 'Confirm'}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, confirmDialog };
}
