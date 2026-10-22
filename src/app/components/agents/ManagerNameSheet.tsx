'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { ModalShell } from '@/app/components/ui/ModalShell';
import {
  isManagerNameTaken,
  managerRefusalCode,
  validateManagerName,
} from '@/lib/agents/supervisorManagers';
import { useStore } from '@/lib/store';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';

const NAME_TAKEN_REASON = 'A Project Manager with this name exists.';
/** Refusals about the name itself belong under the field; the rest are reported as toasts. */
const FIELD_REFUSALS = new Set(['manager_name_invalid', 'manager_name_taken']);

interface ManagerNameSheetProps {
  title: string;
  confirmLabel: string;
  initialName: string;
  /** The address the name will get, shown under the field. Not editable: it never changes later. */
  addressFor: (name: string) => string;
  managers: Pick<SupervisorManager, 'key' | 'name' | 'archivedAt'>[];
  /** A rename may keep its own name. */
  exceptKey?: string;
  /** Something other than the name stops the action; shown as the reason. */
  blockedReason?: string;
  /** Rust decides. A throw keeps the sheet open. */
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
  /** Explanatory copy between the field and the buttons. */
  children?: ReactNode;
}

/** Why the button is off, or null when the name can go to Rust. */
function disabledReason(
  name: string,
  props: Pick<ManagerNameSheetProps, 'managers' | 'exceptKey' | 'blockedReason'>
): string | null {
  const checked = validateManagerName(name);
  if (!checked.ok) return checked.reason;
  if (isManagerNameTaken(checked.name, props.managers, props.exceptKey)) return NAME_TAKEN_REASON;
  return props.blockedReason ?? null;
}

/**
 * One modal sheet with one field: the name of a Project Manager. Promote and
 * Rename share it. The button is never silently grey: the reason sits under
 * the field.
 */
export function ManagerNameSheet({
  title,
  confirmLabel,
  initialName,
  addressFor,
  managers,
  exceptKey,
  blockedReason,
  onSubmit,
  onClose,
  children,
}: ManagerNameSheetProps) {
  const showToast = useStore((s) => s.showToast);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const reason = disabledReason(name, { managers, exceptKey, blockedReason });
  const checked = validateManagerName(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (reason !== null || !checked.ok || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await onSubmit(checked.name);
      onClose();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const code = managerRefusalCode(cause);
      if (code && FIELD_REFUSALS.has(code)) setRefusal(detail);
      else showToast(detail, 'error');
      setBusy(false);
    }
  };

  return (
    <ModalShell
      id="manager-name-sheet"
      title={title}
      onClose={onClose}
      className="w-[26rem] max-w-[calc(100vw-2rem)]"
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="manager-name" className="text-xs font-medium text-foreground-muted">
            Name
          </label>
          <input
            id="manager-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setRefusal(null);
            }}
            placeholder="Release Desk"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="rounded-md border border-border-dark bg-black/20 px-2.5 py-1.5 text-sm text-foreground placeholder:text-foreground-muted/50 focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          />
          {checked.ok && (
            <p className="font-mono text-[11px] text-foreground-muted">
              Address: {addressFor(checked.name)}
            </p>
          )}
          {refusal ? (
            <p role="alert" className="text-[11px] text-red-400">
              {refusal}
            </p>
          ) : (
            reason && <p className="text-[11px] text-foreground-muted">{reason}</p>
          )}
        </div>
        {children}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={reason !== null || busy}
            title={reason ?? undefined}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
