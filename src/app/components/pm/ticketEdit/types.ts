import type { PmTicket, PmEpic, PmTestCase, PmDependency } from '@/lib/pm/types';
import { TICKET_STATUSES } from '@/lib/pm/enums';
import { PRIORITY_NAME, TICKET_STATUS_NAME } from '@/lib/pm/labels';
import { TICKET_STATUS_BADGE_CLASS } from '@/lib/pm/ticketStatusStyle';

export type DetailTab = 'details' | 'context' | 'testcases' | 'dependencies' | 'advanced';

export interface TicketEditPanelProps {
  ticket: PmTicket | null;
  epics: PmEpic[];
  allTickets: PmTicket[];
  testCases: PmTestCase[];
  dependencies: PmDependency[];
  availableItems: { id: string; type: 'epic' | 'ticket'; name: string; status?: string }[];
  onUpdateTicket: (id: string, updates: Partial<PmTicket>) => void;
  onSave?: () => Promise<void>;
  onSaveAndClose?: () => Promise<void>;
  onCancel?: () => void;
  onDeleteTicket: (id: string) => void;
  onMoveTicket: (ticketId: string, newEpicId: string) => void;
  onAddTestCase: (initial?: Partial<PmTestCase>) => void;
  onUpdateTestCase: (id: string, updates: Partial<PmTestCase>) => void;
  onDeleteTestCase: (id: string) => void;
  onAddDependency: (dep: PmDependency) => void;
  onRemoveDependency: (id: string) => void;
}

export const statusOptions: { value: PmTicket['status']; label: string; className: string }[] =
  TICKET_STATUSES.map((value) => ({
    value,
    label: TICKET_STATUS_NAME[value],
    className: TICKET_STATUS_BADGE_CLASS[value],
  }));

export const priorityOptions: { value: PmTicket['priority']; label: string; className: string }[] =
  [
    {
      value: 'low',
      label: PRIORITY_NAME.low,
      className: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
    },
    {
      value: 'normal',
      label: PRIORITY_NAME.normal,
      className: 'bg-white/10 text-foreground border-white/20',
    },
    {
      value: 'high',
      label: PRIORITY_NAME.high,
      className: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
    },
    {
      value: 'critical',
      label: PRIORITY_NAME.critical,
      className: 'bg-red-500/10 text-red-300 border-red-500/20',
    },
  ];

export const modelPowerOptions: {
  value: PmTicket['modelPower'];
  label: string;
  className: string;
}[] = [
  {
    value: 'low',
    label: PRIORITY_NAME.low,
    className: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  },
  {
    value: 'medium',
    label: 'Medium',
    className: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
  },
  {
    value: 'high',
    label: PRIORITY_NAME.high,
    className: 'bg-red-500/10 text-red-300 border-red-500/20',
  },
];

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
