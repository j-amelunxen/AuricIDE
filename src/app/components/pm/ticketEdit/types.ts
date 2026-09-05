import type { PmTicket, PmEpic, PmTestCase, PmDependency } from '@/lib/tauri/pm';

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

export const statusOptions: { value: PmTicket['status']; label: string; className: string }[] = [
  { value: 'open', label: 'Open', className: 'bg-white/10 text-foreground-muted' },
  { value: 'in_progress', label: 'In Progress', className: 'bg-yellow-500/10 text-git-modified' },
  { value: 'to_test', label: 'To Test', className: 'bg-cyan-500/10 text-cyan-300' },
  { value: 'in_review', label: 'In Review', className: 'bg-indigo-500/10 text-indigo-300' },
  { value: 'done', label: 'Done', className: 'bg-green-500/10 text-git-added' },
  { value: 'archived', label: 'Archived', className: 'bg-purple-500/10 text-purple-400' },
  { value: 'discarded', label: 'Discarded', className: 'bg-white/5 text-foreground-muted' },
];

export const priorityOptions: { value: PmTicket['priority']; label: string; className: string }[] =
  [
    { value: 'low', label: 'Low', className: 'bg-blue-500/10 text-blue-300 border-blue-500/20' },
    { value: 'normal', label: 'Normal', className: 'bg-white/10 text-foreground border-white/20' },
    {
      value: 'high',
      label: 'High',
      className: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
    },
    {
      value: 'critical',
      label: 'Critical',
      className: 'bg-red-500/10 text-red-300 border-red-500/20',
    },
  ];

export const modelPowerOptions: {
  value: PmTicket['modelPower'];
  label: string;
  className: string;
}[] = [
  { value: 'low', label: 'Low', className: 'bg-blue-500/10 text-blue-300 border-blue-500/20' },
  {
    value: 'medium',
    label: 'Medium',
    className: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
  },
  { value: 'high', label: 'High', className: 'bg-red-500/10 text-red-300 border-red-500/20' },
];

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
