'use client';

import { useState } from 'react';
import type { PmEpic, PmTicket } from '@/lib/tauri/pm';
import { InfoTooltip } from '../ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';

interface TicketCreateModalProps {
  isOpen: boolean;
  epics: PmEpic[];
  defaultEpicId: string | null;
  onSave: (
    name: string,
    epicId: string,
    status: PmTicket['status'],
    priority: PmTicket['priority'],
    description: string,
    modelPower?: PmTicket['modelPower']
  ) => void;
  onSaveAndClose: (
    name: string,
    epicId: string,
    status: PmTicket['status'],
    priority: PmTicket['priority'],
    description: string,
    modelPower?: PmTicket['modelPower']
  ) => void;
  onClose: () => void;
}

const statusConfig: { value: PmTicket['status']; label: string; activeClass: string }[] = [
  { value: 'open', label: 'Open', activeClass: 'bg-white/10 text-foreground border-white/20' },
  {
    value: 'in_progress',
    label: 'In Progress',
    activeClass: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/25',
  },
  {
    value: 'done',
    label: 'Done',
    activeClass: 'bg-green-500/15 text-green-300 border-green-500/25',
  },
  {
    value: 'archived',
    label: 'Archived',
    activeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
  },
];

const priorityConfig: { value: PmTicket['priority']; label: string; activeClass: string }[] = [
  { value: 'low', label: 'Low', activeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/25' },
  { value: 'normal', label: 'Normal', activeClass: 'bg-white/10 text-foreground border-white/20' },
  {
    value: 'high',
    label: 'High',
    activeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  },
  {
    value: 'critical',
    label: 'Critical',
    activeClass: 'bg-red-500/15 text-red-300 border-red-500/25',
  },
];

const modelPowerConfig: { value: PmTicket['modelPower']; label: string; activeClass: string }[] = [
  { value: 'low', label: 'Low', activeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/25' },
  {
    value: 'medium',
    label: 'Medium',
    activeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  },
  { value: 'high', label: 'High', activeClass: 'bg-red-500/15 text-red-300 border-red-500/25' },
];

function TicketCreateForm({
  epics,
  defaultEpicId,
  onSave,
  onSaveAndClose,
  onClose,
}: Omit<TicketCreateModalProps, 'isOpen'>) {
  const [name, setName] = useState('');
  const [epicId, setEpicId] = useState(defaultEpicId ?? epics[0]?.id ?? '');
  const [status, setStatus] = useState<PmTicket['status']>('open');
  const [priority, setPriority] = useState<PmTicket['priority']>('normal');
  const [modelPower, setModelPower] = useState<PmTicket['modelPower']>(undefined);
  const [description, setDescription] = useState('');

  const handleCreateOnly = () => {
    if (!name.trim() || !epicId) return;
    onSave(name.trim(), epicId, status, priority, description, modelPower);
    setName('');
    setDescription('');
    setPriority('normal');
    setModelPower(undefined);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !epicId) return;
    onSaveAndClose(name.trim(), epicId, status, priority, description, modelPower);
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative w-[500px] bg-[#0e0e18] border border-white/10 rounded-2xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="text-sm font-semibold text-foreground">New Ticket</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
              Name <span className="text-red-400/70">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/40 focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>

          {/* Epic + Status row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 flex items-center text-xs font-medium text-foreground-muted">
                Epic
                <InfoTooltip description={GUIDANCE.pm.epic} label="i" />
              </label>
              {epics.length > 0 ? (
                <select
                  value={epicId}
                  onChange={(e) => setEpicId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                >
                  {epics.map((epic) => (
                    <option key={epic.id} value={epic.id}>
                      {epic.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-foreground-muted py-2.5">No epics — create one first</p>
              )}
            </div>
            <div>
              <label className="mb-1.5 flex items-center text-xs font-medium text-foreground-muted">
                Status
                <InfoTooltip description={GUIDANCE.pm.status} label="i" />
              </label>
              <div className="flex gap-1">
                {statusConfig.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatus(opt.value)}
                    className={`flex-1 rounded-lg border py-2 text-[10px] font-medium transition-colors leading-none ${
                      status === opt.value
                        ? opt.activeClass
                        : 'border-transparent text-foreground-muted hover:bg-white/5 hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="mb-1.5 flex items-center text-xs font-medium text-foreground-muted">
              Priority
              <InfoTooltip description={GUIDANCE.pm.priority} label="i" />
            </label>
            <div className="flex gap-1" data-testid="priority-selector">
              {priorityConfig.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPriority(opt.value)}
                  className={`flex-1 rounded-lg border py-2 text-[10px] font-medium transition-colors leading-none ${
                    priority === opt.value
                      ? opt.activeClass
                      : 'border-transparent text-foreground-muted hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Model Power */}
          <div>
            <label className="mb-1.5 flex items-center text-xs font-medium text-foreground-muted">
              Model Power (Optional)
              <InfoTooltip description={GUIDANCE.pm.modelPower} label="i" />
            </label>
            <div className="flex gap-2" data-testid="model-power-selector">
              <button
                type="button"
                onClick={() => setModelPower(undefined)}
                className={`flex-1 rounded-lg border py-2 text-[10px] font-medium transition-colors leading-none ${
                  modelPower === undefined
                    ? 'bg-white/10 text-foreground border-white/20'
                    : 'border-transparent text-foreground-muted hover:bg-white/5 hover:text-foreground'
                }`}
              >
                None
              </button>
              {modelPowerConfig.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setModelPower(opt.value)}
                  className={`flex-1 rounded-lg border py-2 text-[10px] font-medium transition-colors leading-none ${
                    modelPower === opt.value
                      ? opt.activeClass
                      : 'border-transparent text-foreground-muted hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add context about this ticket..."
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/40 focus:border-primary/50 focus:outline-none resize-none transition-colors"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-foreground-muted hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim() || !epicId}
            onClick={handleCreateOnly}
            className="rounded-lg bg-white/5 border border-white/10 px-4 py-2 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Create
          </button>
          <button
            type="submit"
            disabled={!name.trim() || !epicId}
            className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/80 transition-colors shadow-lg shadow-primary/20"
          >
            Create and Close
          </button>
        </div>
      </form>
    </div>
  );
}

export function TicketCreateModal({ isOpen, ...props }: TicketCreateModalProps) {
  if (!isOpen) return null;
  return <TicketCreateForm key={`create-${props.defaultEpicId}`} {...props} />;
}
