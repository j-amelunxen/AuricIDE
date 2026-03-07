'use client';

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { PmRequirement } from '@/lib/tauri/requirements';

interface RequirementCreateDialogProps {
  isOpen: boolean;
  existingRequirements: PmRequirement[];
  onSave: (req: PmRequirement) => void;
  onClose: () => void;
}

function generateNextReqId(category: string, existing: PmRequirement[]): string {
  const prefix = category
    ? `REQ-${category
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6)}`
    : 'REQ';
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let max = 0;
  for (const req of existing) {
    const match = req.reqId.match(pattern);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(2, '0')}`;
}

export function RequirementCreateDialog({
  isOpen,
  existingRequirements,
  onSave,
  onClose,
}: RequirementCreateDialogProps) {
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<PmRequirement['type']>('functional');
  const [priority, setPriority] = useState<PmRequirement['priority']>('normal');
  const [rationale, setRationale] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [source, setSource] = useState('');
  const [appliesTo, setAppliesTo] = useState('');

  const reset = useCallback(() => {
    setCategory('');
    setTitle('');
    setDescription('');
    setType('functional');
    setPriority('normal');
    setRationale('');
    setAcceptanceCriteria('');
    setSource('');
    setAppliesTo('');
  }, []);

  const handleSave = useCallback(() => {
    if (!title.trim()) return;
    const reqId = generateNextReqId(category, existingRequirements);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const req: PmRequirement = {
      id: crypto.randomUUID(),
      reqId,
      title: title.trim(),
      description,
      type,
      category: category.trim(),
      priority,
      status: 'draft',
      rationale,
      acceptanceCriteria,
      source,
      lastVerifiedAt: null,
      appliesTo: appliesTo
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      sortOrder: existingRequirements.length,
      createdAt: now,
      updatedAt: now,
    };
    onSave(req);
    reset();
    onClose();
  }, [
    title,
    category,
    description,
    type,
    priority,
    rationale,
    acceptanceCriteria,
    source,
    appliesTo,
    existingRequirements,
    onSave,
    onClose,
    reset,
  ]);

  if (!isOpen) return null;

  const reqIdPreview = generateNextReqId(category, existingRequirements);

  return createPortal(
    <div
      data-testid="requirement-create-dialog"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-background-dark p-6 shadow-2xl">
        <h2 className="text-sm font-bold text-foreground">New Requirement</h2>
        <p className="mt-1 text-[10px] text-foreground-muted">
          Will be assigned: <span className="font-mono text-primary-light">{reqIdPreview}</span>
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Title *
            </span>
            <input
              data-testid="create-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short requirement title"
              className="mt-1 w-full rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/30"
            />
          </label>

          <label>
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Category
            </span>
            <input
              data-testid="create-category-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. auth, perf"
              className="mt-1 w-full rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/30"
            />
          </label>

          <label>
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Type
            </span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as PmRequirement['type'])}
              className="mt-1 w-full rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none"
            >
              <option value="functional">Functional</option>
              <option value="non_functional">Non-Functional</option>
            </select>
          </label>

          <label>
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Priority
            </span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as PmRequirement['priority'])}
              className="mt-1 w-full rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>

          <label>
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Source
            </span>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. spec.md"
              className="mt-1 w-full rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/30"
            />
          </label>

          <label className="col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Applies To
            </span>
            <input
              data-testid="create-applies-to-input"
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value)}
              placeholder="e.g. src/auth/, src/lib/login.ts"
              className="mt-1 w-full rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/30"
            />
          </label>

          <label className="col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-y rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/30"
            />
          </label>

          <label className="col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Acceptance Criteria
            </span>
            <textarea
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              rows={3}
              placeholder="- Criterion 1&#10;- Criterion 2"
              className="mt-1 w-full resize-y rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/30"
            />
          </label>

          <label className="col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Rationale
            </span>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={2}
              className="mt-1 w-full resize-y rounded bg-white/5 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/30"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded bg-white/5 px-4 py-2 text-xs text-foreground-muted hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            data-testid="create-save-btn"
            onClick={handleSave}
            disabled={!title.trim()}
            className="rounded bg-primary/20 px-4 py-2 text-xs font-bold text-primary-light hover:bg-primary/30 disabled:opacity-50"
          >
            Create Requirement
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
