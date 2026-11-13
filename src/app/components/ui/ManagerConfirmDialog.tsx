'use client';

import { ConfirmDialog } from './ConfirmDialog';

const CONFIRMATIONS: Record<
  'archive' | 'remove' | 'restart',
  {
    title: (name: string) => string;
    message: string;
    confirmLabel: string;
    variant: 'destroy' | 'discard' | 'elevate';
  }
> = {
  archive: {
    title: (name) => `Archive ${name}?`,
    message:
      'It leaves Quick Access and the menu bar. Its folder, instructions and memory stay, and a running session keeps running until you stop it.',
    confirmLabel: 'Archive',
    variant: 'discard',
  },
  remove: {
    title: (name) => `Remove ${name}?`,
    message:
      'The Project Manager is forgotten. Its folder stays and becomes an ordinary run. Nothing on disk is deleted.',
    confirmLabel: 'Remove',
    variant: 'destroy',
  },
  restart: {
    title: (name) => `Restart ${name}?`,
    message:
      'Its running session ends and the folder is opened again with the current instructions. Agents it started keep running.',
    confirmLabel: 'Restart',
    variant: 'elevate',
  },
};

/**
 * The confirmation for archiving, removing or restarting a manager. Quick
 * Access and Settings use it too, so one consequence is worded once.
 */
export function ManagerConfirmDialog({
  kind,
  name,
  onConfirm,
  onCancel,
}: {
  kind: 'archive' | 'remove' | 'restart';
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const wording = CONFIRMATIONS[kind];
  return (
    <ConfirmDialog
      title={wording.title(name)}
      message={wording.message}
      confirmLabel={wording.confirmLabel}
      variant={wording.variant}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
