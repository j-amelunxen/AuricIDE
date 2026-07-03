'use client';

import { useState } from 'react';
import type { PmGoal } from '@/lib/tauri/goals';

interface GoalCreateDialogProps {
  isOpen: boolean;
  goals: PmGoal[];
  /** Pre-selected parent when creating a sub-goal from the detail panel. */
  defaultParentId: string | null;
  onSave: (goal: PmGoal) => void;
  onClose: () => void;
}

const inputCls =
  'w-full rounded-lg bg-white/5 px-3 py-2 text-xs text-foreground outline-none placeholder:text-foreground-muted/50 focus:ring-1 focus:ring-primary/30';
const labelCls = 'mb-1 block text-[10px] font-bold uppercase tracking-wide text-foreground-muted';

export function GoalCreateDialog({
  isOpen,
  goals,
  defaultParentId,
  onSave,
  onClose,
}: GoalCreateDialogProps) {
  // The parent renders this dialog only while open (keyed by defaultParentId),
  // so plain initial state is a fresh state per opening.
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [priority, setPriority] = useState<PmGoal['priority']>('normal');
  const [parentId, setParentId] = useState<string>(defaultParentId ?? '');

  if (!isOpen) return null;

  const handleSave = () => {
    if (!name.trim()) return;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    onSave({
      id: crypto.randomUUID(),
      parentId: parentId || null,
      name: name.trim(),
      description,
      successCriteria,
      status: 'active',
      priority,
      goalPrompt: '',
      createdBy: 'ui',
      achievedAt: null,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    });
    onClose();
  };

  return (
    <div
      data-testid="goal-create-dialog"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSave();
      }}
    >
      <div className="w-[520px] max-w-[92vw] rounded-2xl border border-white/10 bg-background-dark p-5 shadow-2xl">
        <div className="mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary-light">flag</span>
          <h2 className="text-sm font-bold text-foreground">
            {parentId ? 'New sub-goal' : 'New goal'}
          </h2>
        </div>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>Name *</label>
            <input
              data-testid="goal-create-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ship the onboarding flow"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Description</label>
            <textarea
              data-testid="goal-create-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What world state should exist when this goal is achieved?"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Success criteria</label>
            <textarea
              data-testid="goal-create-criteria"
              value={successCriteria}
              onChange={(e) => setSuccessCriteria(e.target.value)}
              rows={3}
              placeholder={'- Every criterion should be checkable\n- e.g. "all E2E tests green"'}
              className={inputCls}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelCls}>Priority</label>
              <select
                data-testid="goal-create-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as PmGoal['priority'])}
                className={inputCls}
              >
                {['low', 'normal', 'high', 'critical'].map((p) => (
                  <option key={p} value={p} className="bg-background-dark">
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className={labelCls}>Parent goal</label>
              <select
                data-testid="goal-create-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className={inputCls}
              >
                <option value="" className="bg-background-dark">
                  — root goal —
                </option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id} className="bg-background-dark">
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            data-testid="goal-create-cancel"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            data-testid="goal-create-save"
            onClick={handleSave}
            disabled={!name.trim()}
            className="rounded-lg bg-primary/20 border border-primary/30 px-4 py-1.5 text-xs font-bold text-primary-light hover:bg-primary/30 transition-colors disabled:opacity-40"
          >
            Create goal
          </button>
        </div>
      </div>
    </div>
  );
}
