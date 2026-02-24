'use client';

import React, { Component, useEffect } from 'react';
import type { FrontendError } from '@/lib/tauri/crashlog';

function sendCrashReport(error: FrontendError): void {
  import('@/lib/tauri/crashlog')
    .then((mod) => mod.reportFrontendCrash(error))
    .catch(() => {
      // IPC not available (browser mode) — silently ignore
    });
}

export function GlobalErrorHandlers(): React.ReactElement | null {
  useEffect(() => {
    function handleError(event: ErrorEvent): void {
      sendCrashReport({
        message: event.message || 'Unknown error',
        source: event.filename || null,
        lineno: event.lineno || null,
        colno: event.colno || null,
        stack: event.error?.stack || null,
        componentStack: null,
        errorType: 'frontend_onerror',
      });
    }

    function handleRejection(event: PromiseRejectionEvent): void {
      const reason = event.reason;
      sendCrashReport({
        message: reason?.message || String(reason) || 'Unhandled promise rejection',
        source: null,
        lineno: null,
        colno: null,
        stack: reason?.stack || null,
        componentStack: null,
        errorType: 'frontend_unhandledrejection',
      });
    }

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null;
}

interface CrashBoundaryProps {
  children: React.ReactNode;
}

interface CrashBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class CrashBoundary extends Component<CrashBoundaryProps, CrashBoundaryState> {
  constructor(props: CrashBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): CrashBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    sendCrashReport({
      message: error.message,
      source: null,
      lineno: null,
      colno: null,
      stack: error.stack || null,
      componentStack: errorInfo.componentStack || null,
      errorType: 'frontend_react_boundary',
    });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-zinc-200">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-zinc-400">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <p className="text-xs text-zinc-500">A crash report has been saved.</p>
            <button
              onClick={() => window.location.reload()}
              className="rounded bg-zinc-700 px-4 py-2 text-sm hover:bg-zinc-600"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
