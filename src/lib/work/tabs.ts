export type WorkTab = 'goals' | 'tickets' | 'requirements' | 'lines';

export const WORK_TABS: { id: WorkTab; label: string }[] = [
  { id: 'goals', label: 'Goals' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'lines', label: 'Lines' },
];
