'use client';

import { useState, useCallback } from 'react';
import type { PmRequirement } from '@/lib/tauri/requirements';

interface RequirementDetailPanelProps {
  requirement: PmRequirement | null;
  onUpdate: (id: string, updates: Partial<PmRequirement>) => void;
  onDelete: (id: string) => void;
  onVerify?: (id: string) => void;
  testCases?: Array<{ id: string; title: string }>;
}

const STATUS_OPTIONS = ['draft', 'active', 'implemented', 'verified', 'deprecated'] as const;
const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'critical'] as const;
const TYPE_OPTIONS = ['functional', 'non_functional'] as const;

export function RequirementDetailPanel({
  requirement,
  onUpdate,
  onDelete,
  onVerify,
  testCases,
}: RequirementDetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<PmRequirement>>({});

  const startEditing = useCallback(() => {
    setDraft({});
    setEditing(true);
  }, []);

  const cancelEditing = useCallback(() => {
    setDraft({});
    setEditing(false);
  }, []);

  const saveEdits = useCallback(() => {
    if (!requirement) return;
    if (Object.keys(draft).length > 0) {
      onUpdate(requirement.id, draft);
    }
    setDraft({});
    setEditing(false);
  }, [requirement, draft, onUpdate]);

  if (!requirement) {
    return (
      <div
        data-testid="requirement-detail-empty"
        className="flex flex-1 items-center justify-center text-sm text-foreground-muted"
      >
        Select a requirement to view details
      </div>
    );
  }

  const current = { ...requirement, ...draft };

  return (
    <div data-testid="requirement-detail" className="flex flex-1 flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <span className="font-mono text-xs text-primary-light">{current.reqId}</span>
          {editing ? (
            <input
              data-testid="detail-title-input"
              value={current.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              className="mt-1 block w-full rounded bg-white/5 px-2 py-1 text-lg font-bold text-foreground outline-none focus:ring-1 focus:ring-primary/30"
            />
          ) : (
            <h2 className="mt-1 text-lg font-bold text-foreground">{current.title}</h2>
          )}
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={saveEdits}
                className="rounded bg-primary/20 px-3 py-1 text-xs font-bold text-primary-light hover:bg-primary/30"
              >
                Save
              </button>
              <button
                onClick={cancelEditing}
                className="rounded bg-white/5 px-3 py-1 text-xs text-foreground-muted hover:bg-white/10"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                data-testid="detail-edit-btn"
                onClick={startEditing}
                className="rounded bg-white/5 px-3 py-1 text-xs text-foreground-muted hover:bg-white/10"
              >
                Edit
              </button>
              <button
                data-testid="detail-delete-btn"
                onClick={() => onDelete(requirement.id)}
                className="rounded bg-red-500/10 px-3 py-1 text-xs text-red-400 hover:bg-red-500/20"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Field label="Status">
          {editing ? (
            <select
              value={current.status}
              onChange={(e) =>
                setDraft((d) => ({ ...d, status: e.target.value as PmRequirement['status'] }))
              }
              className="w-full rounded bg-white/5 px-2 py-1 text-foreground outline-none"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          ) : (
            <span className="capitalize">{current.status}</span>
          )}
        </Field>
        <Field label="Priority">
          {editing ? (
            <select
              value={current.priority}
              onChange={(e) =>
                setDraft((d) => ({ ...d, priority: e.target.value as PmRequirement['priority'] }))
              }
              className="w-full rounded bg-white/5 px-2 py-1 text-foreground outline-none"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          ) : (
            <span className="capitalize">{current.priority}</span>
          )}
        </Field>
        <Field label="Type">
          {editing ? (
            <select
              value={current.type}
              onChange={(e) =>
                setDraft((d) => ({ ...d, type: e.target.value as PmRequirement['type'] }))
              }
              className="w-full rounded bg-white/5 px-2 py-1 text-foreground outline-none"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t === 'non_functional' ? 'Non-Functional' : 'Functional'}
                </option>
              ))}
            </select>
          ) : (
            <span>{current.type === 'non_functional' ? 'Non-Functional' : 'Functional'}</span>
          )}
        </Field>
        <Field label="Category">
          {editing ? (
            <input
              value={current.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              className="w-full rounded bg-white/5 px-2 py-1 text-foreground outline-none"
            />
          ) : (
            <span>{current.category || '—'}</span>
          )}
        </Field>
        <Field label="Source" colSpan={2}>
          {editing ? (
            <input
              value={current.source}
              onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
              className="w-full rounded bg-white/5 px-2 py-1 text-foreground outline-none"
            />
          ) : (
            <span>{current.source || '—'}</span>
          )}
        </Field>
        <Field label="Last Verified">
          <span className="flex items-center gap-2">
            <span data-testid="detail-last-verified">{current.lastVerifiedAt ?? 'Never'}</span>
            {onVerify && (
              <button
                data-testid="detail-verify-btn"
                onClick={() => onVerify(requirement.id)}
                className="rounded bg-emerald-500/15 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25 transition-colors"
              >
                Verify Now
              </button>
            )}
          </span>
        </Field>
        <Field label="Applies To" colSpan={2}>
          {editing ? (
            <input
              data-testid="detail-applies-to-input"
              value={(current.appliesTo ?? []).join(', ')}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  appliesTo: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                }))
              }
              className="w-full rounded bg-white/5 px-2 py-1 text-foreground outline-none"
              placeholder="Comma-separated paths"
            />
          ) : (
            <div className="flex flex-wrap gap-1">
              {(current.appliesTo ?? []).length > 0 ? (
                current.appliesTo.map((path) => (
                  <span
                    key={path}
                    className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-mono text-foreground-muted border border-white/10"
                  >
                    {path}
                  </span>
                ))
              ) : (
                <span className="text-foreground-muted">—</span>
              )}
            </div>
          )}
        </Field>
      </div>

      <TextArea
        label="Description"
        value={current.description}
        editing={editing}
        onChange={(val) => setDraft((d) => ({ ...d, description: val }))}
      />

      <TextArea
        label="Rationale"
        value={current.rationale}
        editing={editing}
        onChange={(val) => setDraft((d) => ({ ...d, rationale: val }))}
      />

      <TextArea
        label="Acceptance Criteria"
        value={current.acceptanceCriteria}
        editing={editing}
        onChange={(val) => setDraft((d) => ({ ...d, acceptanceCriteria: val }))}
      />

      <div className="mt-4" data-testid="detail-linked-tests">
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
          Linked Test Cases
        </span>
        {testCases && testCases.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {testCases.map((tc) => (
              <li key={tc.id} className="text-xs text-foreground">
                {tc.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-foreground-muted">No linked tests</p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  colSpan,
}: {
  label: string;
  children: React.ReactNode;
  colSpan?: number;
}) {
  return (
    <div className={colSpan === 2 ? 'col-span-2' : ''}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
        {label}
      </span>
      <div className="mt-0.5 text-foreground">{children}</div>
    </div>
  );
}

function TextArea({
  label,
  value,
  editing,
  onChange,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (val: string) => void;
}) {
  return (
    <div className="mt-4">
      <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
        {label}
      </span>
      {editing ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="mt-1 w-full resize-y rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/30"
        />
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
          {value || '—'}
        </p>
      )}
    </div>
  );
}
