'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface CanvasTicketBadgeProps {
  ticketId: string;
  onTicketClick?: (ticketId: string) => void;
}

export function CanvasTicketBadge({ ticketId, onTicketClick }: CanvasTicketBadgeProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onTicketClick?.(ticketId);
      }}
      title={`Linked ticket: ${ticketId.slice(0, 8)}…`}
      className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md
        bg-primary/20 border border-primary/30 px-1.5 py-0.5
        text-[9px] font-bold text-primary-light
        hover:bg-primary/30 transition shadow-sm"
    >
      <AuricIcon name="confirmation_number" className="text-[12px]" />
      Ticket
    </button>
  );
}
