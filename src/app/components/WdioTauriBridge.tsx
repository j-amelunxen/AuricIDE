'use client';

import { useEffect } from 'react';

/**
 * This import is compiled only for the dedicated native E2E build. The normal
 * app neither exposes the global Tauri API nor registers the Rust WDIO plugins.
 */
export function WdioTauriBridge() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E_WEBDRIVER === '1') {
      void import('@wdio/tauri-plugin');
    }
  }, []);

  return null;
}
