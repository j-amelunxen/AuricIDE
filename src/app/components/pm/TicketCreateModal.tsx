'use client';

import { useState } from 'react';
import type { PmEpic, PmTicket, PmDependency } from '@/lib/tauri/pm';
import { InfoTooltip } from '../ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { useLLM } from '@/lib/hooks/useLLM';
import {
  generateDependencyProposalPrompt,
  parseDependencyResponse,
} from '@/lib/pm/dependencyProposal';
import { DependencyProposalModal } from './DependencyProposalModal';
import { DependencySelector } from './DependencySelector';

interface TicketCreateModalProps {
  isOpen: boolean;
  epics: PmEpic[];
  allTickets: PmTicket[];
  availableItems: { id: string; type: 'epic' | 'ticket'; name: string; status?: string }[];
  defaultEpicId: string | null;
  onSave: (
    ticket: Omit<PmTicket, 'createdAt' | 'updatedAt' | 'statusUpdatedAt' | 'sortOrder'>,
    dependencies: PmDependency[]
  ) => void;
  onSaveAndClose: (
    ticket: Omit<PmTicket, 'createdAt' | 'updatedAt' | 'statusUpdatedAt' | 'sortOrder'>,
    dependencies: PmDependency[]
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

type DetailTab = 'details' | 'dependencies';

function TicketCreateForm({
  epics,
  allTickets,
  availableItems,
  defaultEpicId,
  onSave,
  onSaveAndClose,
  onClose,
}: Omit<TicketCreateModalProps, 'isOpen'>) {
  const [ticketId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [epicId, setEpicId] = useState(defaultEpicId ?? epics[0]?.id ?? '');
  const [status, setStatus] = useState<PmTicket['status']>('open');
  const [priority, setPriority] = useState<PmTicket['priority']>('normal');
  const [modelPower, setModelPower] = useState<PmTicket['modelPower']>(undefined);
  const [description, setDescription] = useState('');
  const [localDependencies, setLocalDependencies] = useState<PmDependency[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTab>('details');

  const { call: llmCall, isLoading: isLlmLoading } = useLLM();
  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string; reason: string }[]>(
    []
  );
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);

  const getTicketData = () => ({
    id: ticketId,
    name: name.trim(),
    epicId,
    status,
    priority,
    description,
    modelPower,
    context: [],
  });

  const handleCreateOnly = () => {
    if (!name.trim() || !epicId) return;
    onSave(getTicketData(), localDependencies);
    // Reset but keep ticketId for next if needed? Actually TicketCreateModal re-keys on defaultEpicId
    setName('');
    setDescription('');
    setPriority('normal');
    setModelPower(undefined);
    setLocalDependencies([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !epicId) return;
    onSaveAndClose(getTicketData(), localDependencies);
  };

  const handleProposeDependencies = async () => {
    const epic = epics.find((e) => e.id === epicId);
    if (!epic) return;

    setProposalModalOpen(true);
    setSuggestions([]);
    setSelectedSuggestionIds([]);

    const epicTickets = allTickets.filter((t) => t.epicId === epicId);
    const dummyTicket: PmTicket = {
      ...getTicketData(),
      statusUpdatedAt: new Date().toISOString(),
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const prompt = generateDependencyProposalPrompt(dummyTicket, epic, epicTickets);

    const response = await llmCall([{ role: 'user', content: prompt }]);
    if (response) {
      const parsed = parseDependencyResponse(response);
      const suggestionsWithNames = parsed
        .map((s) => {
          const depTicket = allTickets.find((t) => t.id === s.id);
          return { ...s, name: depTicket?.name || 'Unknown' };
        })
        .filter((s) => s.id !== ticketId);

      setSuggestions(suggestionsWithNames);
      setSelectedSuggestionIds(suggestionsWithNames.map((s) => s.id));
    }
  };

  const handleConfirmSuggestions = () => {
    const newDeps = selectedSuggestionIds
      .filter((id) => !localDependencies.some((d) => d.targetId === id))
      .map((id) => ({
        id: crypto.randomUUID(),
        sourceType: 'ticket' as const,
        sourceId: ticketId,
        targetType: 'ticket' as const,
        targetId: id,
      }));

    setLocalDependencies((prev) => [...prev, ...newDeps]);
    setProposalModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[500px] flex flex-col bg-[#0e0e18] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
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

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'details'
                ? 'border-primary text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            Details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('dependencies')}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'dependencies'
                ? 'border-primary text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            Dependencies
            {localDependencies.length > 0 && (
              <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">
                {localDependencies.length}
              </span>
            )}
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto max-h-[60vh]">
          {activeTab === 'details' ? (
            <>
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
                    <p className="text-xs text-foreground-muted py-2.5">
                      No epics — create one first
                    </p>
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
            </>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground-muted">Dependencies</label>
                <button
                  type="button"
                  onClick={handleProposeDependencies}
                  className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1.5 text-[10px] font-bold text-primary-light transition-all hover:bg-primary/20"
                >
                  <span className="material-symbols-outlined text-[14px]">lightbulb</span>
                  Propose Dependencies
                </button>
              </div>
              <DependencySelector
                dependencies={localDependencies}
                availableItems={availableItems}
                currentItemId={ticketId}
                onAdd={(dep) => setLocalDependencies((prev) => [...prev, dep])}
                onRemove={(id) => setLocalDependencies((prev) => prev.filter((d) => d.id !== id))}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/10 shrink-0">
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
            type="button"
            disabled={!name.trim() || !epicId}
            onClick={handleSubmit}
            className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/80 transition-colors shadow-lg shadow-primary/20"
          >
            Create and Close
          </button>
        </div>
      </div>

      <DependencyProposalModal
        isOpen={proposalModalOpen}
        onClose={() => setProposalModalOpen(false)}
        onConfirm={handleConfirmSuggestions}
        suggestions={suggestions}
        selectedIds={selectedSuggestionIds}
        onToggleSuggestion={(id) =>
          setSelectedSuggestionIds((prev) =>
            prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
          )
        }
        isLoading={isLlmLoading}
      />
    </div>
  );
}

export function TicketCreateModal({ isOpen, ...props }: TicketCreateModalProps) {
  if (!isOpen) return null;
  return <TicketCreateForm key={`create-${props.defaultEpicId}`} {...props} />;
}
