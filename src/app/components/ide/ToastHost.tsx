'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import type { Toast } from '@/lib/store/toastSlice';

const VARIANT_STYLES: Record<Toast['variant'], string> = {
  error: 'border-red-500/40 bg-red-500/10 text-red-200',
  success: 'border-git-added/40 bg-[rgba(46,255,165,0.12)] text-git-added',
  info: 'border-primary/40 bg-primary/10 text-primary-light',
};

const VARIANT_ICON: Record<Toast['variant'], string> = {
  error: 'error',
  success: 'check_circle',
  info: 'info',
};

const AUTO_DISMISS_MS = 5000;

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useStore((s) => s.dismissToast);

  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, dismissToast]);

  return (
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      data-testid={`toast-${toast.variant}`}
      className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200 ${VARIANT_STYLES[toast.variant]}`}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
        {VARIANT_ICON[toast.variant]}
      </span>
      <span className="max-w-xs">{toast.message}</span>
      <button
        onClick={() => dismissToast(toast.id)}
        aria-label="Dismiss notification"
        className="ml-1 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
          close
        </span>
      </button>
    </div>
  );
}

/** Fixed, bottom-right stack of transient notifications. */
export function ToastHost() {
  const toasts = useStore((s) => s.toasts);

  return (
    <div
      data-testid="toast-host"
      className="pointer-events-none fixed bottom-4 right-4 z-[500] flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
