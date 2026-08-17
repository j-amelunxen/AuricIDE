'use client';

import { useEffect, useState } from 'react';
import { useStatusBarClock } from '@/lib/settings/statusBarClock';

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Ticks once a minute rather than on an interval started at mount, so the
 * displayed minute never sits stale for up to 59s after it has actually
 * changed.
 */
export function StatusBarClock() {
  const [show] = useStatusBarClock();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!show) return;
    const msIntoMinute = now.getSeconds() * 1000 + now.getMilliseconds();
    const msToNextMinute = 60_000 - msIntoMinute;
    const timeout = setTimeout(() => setNow(new Date()), msToNextMinute);
    return () => clearTimeout(timeout);
  }, [show, now]);

  if (!show) return null;

  return (
    <>
      <div className="h-3 w-[1px] bg-white/10" />
      <span data-testid="status-bar-clock" className="font-mono tabular-nums">
        {formatTime(now)}
      </span>
    </>
  );
}
