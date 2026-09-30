'use client';

import { useMemo } from 'react';
import { usageForTicket } from '@/lib/pm/usage/aggregate';
import { UsageCard } from './cost/UsageCard';
import { useProjectUsageRows } from './cost/useProjectUsageRows';

/** What the agent runs for this ticket cost, from the recorded usage. */
export function TicketCost({ ticketId }: { ticketId: string }) {
  const rows = useProjectUsageRows();
  const ticketRows = useMemo(() => usageForTicket(rows, ticketId), [rows, ticketId]);
  return <UsageCard rows={ticketRows} />;
}
