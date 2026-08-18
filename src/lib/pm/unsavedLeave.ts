import type { ConfirmRequest } from '@/lib/hooks/useConfirm';

/** Same question the Plan modal already asks on Close. */
export const DISCARD_UNSAVED_PM: ConfirmRequest = {
  title: 'Discard changes?',
  message: 'Discard unsaved changes?',
  confirmLabel: 'Discard',
  variant: 'discard',
};

export function ticketCreateFormIsDirty(input: {
  name: string;
  description: string;
  status: string;
  priority: string;
  dependencyCount: number;
  skillCount?: number;
  initialName?: string;
  initialDescription?: string;
}): boolean {
  return (
    input.name.trim() !== (input.initialName ?? '').trim() ||
    input.description !== (input.initialDescription ?? '') ||
    input.status !== 'open' ||
    input.priority !== 'normal' ||
    input.dependencyCount > 0 ||
    (input.skillCount ?? 0) > 0
  );
}
