'use client';

import { useState } from 'react';
import type { PmTicket, PmEpic, PmTestCase, PmDependency } from '@/lib/tauri/pm';
import { TestCaseEditor } from './TestCaseEditor';
import { DependencySelector } from './DependencySelector';
import { TicketContextEditor } from './TicketContextEditor';
import { useStore } from '@/lib/store';
import { generateTicketPrompt } from '@/lib/pm/prompt';
import { InfoTooltip } from '../ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { useLLM } from '@/lib/hooks/useLLM';
import {
  generateDependencyProposalPrompt,
  parseDependencyResponse,
} from '@/lib/pm/dependencyProposal';
import { DependencyProposalModal } from './DependencyProposalModal';

interface TicketEditPanelProps {
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
  onAddTestCase: () => void;
  onUpdateTestCase: (id: string, updates: Partial<PmTestCase>) => void;
  onDeleteTestCase: (id: string) => void;
  onAddDependency: (dep: PmDependency) => void;
  onRemoveDependency: (id: string) => void;
}

const statusOptions: { value: PmTicket['status']; label: string; className: string }[] = [
  { value: 'open', label: 'Open', className: 'bg-white/10 text-foreground-muted' },
  { value: 'in_progress', label: 'In Progress', className: 'bg-yellow-500/10 text-git-modified' },
  { value: 'done', label: 'Done', className: 'bg-green-500/10 text-git-added' },
  { value: 'archived', label: 'Archived', className: 'bg-purple-500/10 text-purple-400' },
];

const priorityOptions: { value: PmTicket['priority']; label: string; className: string }[] = [
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

const modelPowerOptions: {
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

type DetailTab = 'details' | 'context' | 'testcases' | 'dependencies' | 'advanced';

export function TicketEditPanel({
  ticket,
  epics,
  allTickets,
  testCases,
  dependencies,
  availableItems,
  onUpdateTicket,
  onSave,
  onSaveAndClose,
  onCancel,
  onDeleteTicket,
  onMoveTicket,
  onAddTestCase,
  onUpdateTestCase,
  onDeleteTestCase,
  onAddDependency,
  onRemoveDependency,
}: TicketEditPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('details');
  const [copied, setCopied] = useState(false);
  const pmDirty = useStore((s) => s.pmDirty);
  const setSpawnDialogOpen = useStore((s) => s.setSpawnDialogOpen);
  const setInitialAgentTask = useStore((s) => s.setInitialAgentTask);
  const setSpawnAgentTicketId = useStore((s) => s.setSpawnAgentTicketId);
  const rootPath = useStore((s) => s.rootPath);

  const { call: llmCall, isLoading: isLlmLoading } = useLLM();
  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string; reason: string }[]>(
    []
  );
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);

  if (!ticket) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
        Select a ticket
      </div>
    );
  }

  const handleProposeDependencies = async () => {
    const epic = epics.find((e) => e.id === ticket.epicId);
    if (!epic) return;

    setProposalModalOpen(true);
    setSuggestions([]);
    setSelectedSuggestionIds([]);

    const epicTickets = allTickets.filter((t) => t.epicId === ticket.epicId);
    const prompt = generateDependencyProposalPrompt(ticket, epic, epicTickets);

    const response = await llmCall([{ role: 'user', content: prompt }]);
    if (response) {
      const parsed = parseDependencyResponse(response);
      const suggestionsWithNames = parsed
        .map((s) => {
          const depTicket = allTickets.find((t) => t.id === s.id);
          return { ...s, name: depTicket?.name || 'Unknown' };
        })
        .filter((s) => s.id !== ticket.id);

      setSuggestions(suggestionsWithNames);
      setSelectedSuggestionIds(suggestionsWithNames.map((s) => s.id));
    }
  };

  const handleConfirmSuggestions = () => {
    selectedSuggestionIds.forEach((id) => {
      // Avoid duplicates
      if (!dependencies.some((d) => d.targetId === id)) {
        onAddDependency({
          id: crypto.randomUUID(),
          sourceType: 'ticket',
          sourceId: ticket.id,
          targetType: 'ticket',
          targetId: id,
        });
      }
    });
    setProposalModalOpen(false);
  };

  const getPrompt = () => {
    return generateTicketPrompt(ticket, testCases, dependencies, availableItems, rootPath);
  };

  const isBlocked = dependencies.some((dep) => {
    const item = availableItems.find((i) => i.id === dep.targetId);
    return item && item.type === 'ticket' && item.status !== 'done' && item.status !== 'archived';
  });

  const handleSpawnAgent = async () => {
    onUpdateTicket(ticket.id, { status: 'in_progress' });
    if (onSave) {
      await onSave();
    }
    const prompt = await getPrompt();
    setInitialAgentTask(prompt);
    setSpawnAgentTicketId(ticket.id);
    setSpawnDialogOpen(true);
  };

  const handleCopyPrompt = async () => {
    const prompt = await getPrompt();
    navigator.clipboard
      .writeText(prompt)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Fallback or ignore
      });
  };

  const tabs: { key: DetailTab; label: string; count?: number }[] = [
    { key: 'details', label: 'Details' },
    { key: 'context', label: 'Context', count: ticket.context?.length || 0 },
    { key: 'testcases', label: 'Test Cases', count: testCases.length },
    { key: 'dependencies', label: 'Dependencies', count: dependencies.length },
    { key: 'advanced', label: 'Advanced Settings' },
  ];

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  }

  return (
    <div className="flex h-full flex-col">
      {isBlocked && (
        <div className="flex items-center gap-2 bg-git-deleted/10 px-4 py-2 border-b border-git-deleted/20">
          <span className="material-symbols-outlined text-[16px] text-git-deleted">warning</span>
          <span className="text-[11px] font-medium text-git-deleted">
            This ticket is blocked by unfinished dependencies.
          </span>
        </div>
      )}
      {/* Toolbar — sticky, never scrolls */}
      <div className="shrink-0 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={ticket.name}
            onChange={(e) => onUpdateTicket(ticket.id, { name: e.target.value })}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
          />

          <div className="flex gap-1">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onUpdateTicket(ticket.id, { status: opt.value })}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  ticket.status === opt.value
                    ? opt.className
                    : 'text-foreground-muted hover:bg-white/5'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <select
            value={ticket.epicId}
            onChange={(e) => onMoveTicket(ticket.id, e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
          >
            {epics.map((epic) => (
              <option key={epic.id} value={epic.id}>
                {epic.name}
              </option>
            ))}
          </select>

          <div className="h-4 w-px bg-white/10 mx-1" />

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onCancel}
              title="Close editor and discard local changes"
              className="rounded-lg px-2 py-1.5 text-[10px] font-medium text-foreground-muted hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!pmDirty}
              onClick={onSave}
              className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-[10px] font-medium text-foreground hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              Save
            </button>
            <button
              type="button"
              disabled={!pmDirty}
              onClick={onSaveAndClose}
              className="rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1.5 text-[10px] font-bold text-primary-light hover:bg-primary/20 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              Save and Close
            </button>
          </div>

          <div className="h-4 w-px bg-white/10 mx-1" />

          <button
            type="button"
            onClick={handleSpawnAgent}
            className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-3 py-1.5 text-xs font-bold text-primary-light transition-all hover:bg-primary/20"
          >
            <span className="material-symbols-outlined text-[16px]">smart_toy</span>
            Spawn Agent
          </button>

          <button
            type="button"
            onClick={handleCopyPrompt}
            title="Copy prompt to clipboard"
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
              copied
                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                : 'bg-white/5 border-white/10 text-foreground-muted hover:bg-white/10 hover:text-foreground'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {copied ? 'check' : 'content_copy'}
            </span>
            {copied ? 'Copied!' : 'Copy Prompt'}
          </button>

          <button
            type="button"
            aria-label="Delete ticket"
            onClick={() => onDeleteTicket(ticket.id)}
            className="rounded-lg p-1.5 text-foreground-muted opacity-50 hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="shrink-0 flex border-b border-white/10 px-4" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground hover:border-white/20'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content — scrollable */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'details' && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-2 flex items-center text-xs text-foreground-muted">
                Priority
                <InfoTooltip description={GUIDANCE.pm.priority} label="i" />
              </label>
              <div className="flex gap-2" data-testid="priority-selector">
                {priorityOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onUpdateTicket(ticket.id, { priority: opt.value })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
                      ticket.priority === opt.value
                        ? opt.className
                        : 'border-transparent text-foreground-muted hover:bg-white/5'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 flex items-center text-xs text-foreground-muted">
                Model Power
                <InfoTooltip description={GUIDANCE.pm.modelPower} label="i" />
              </label>
              <div className="flex gap-2" data-testid="model-power-selector">
                <button
                  type="button"
                  onClick={() => onUpdateTicket(ticket.id, { modelPower: undefined })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
                    ticket.modelPower === undefined
                      ? 'bg-white/10 text-foreground border-white/20'
                      : 'border-transparent text-foreground-muted hover:bg-white/5'
                  }`}
                >
                  None
                </button>
                {modelPowerOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onUpdateTicket(ticket.id, { modelPower: opt.value })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
                      ticket.modelPower === opt.value
                        ? opt.className
                        : 'border-transparent text-foreground-muted hover:bg-white/5'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-foreground-muted">Description</label>
              <textarea
                value={ticket.description}
                onChange={(e) => onUpdateTicket(ticket.id, { description: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none resize-none"
                rows={8}
              />
            </div>

            <div className="flex gap-4 text-xs text-foreground-muted">
              <span>Created: {formatDate(ticket.createdAt)}</span>
              <span>Updated: {formatDate(ticket.updatedAt)}</span>
            </div>
          </div>
        )}

        {activeTab === 'context' && (
          <div className="flex flex-col h-full">
            <div className="mb-2 flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider">
              Context
              <InfoTooltip description={GUIDANCE.pm.context} label="i" />
            </div>
            <TicketContextEditor
              context={ticket.context}
              onUpdate={(newContext) => onUpdateTicket(ticket.id, { context: newContext })}
            />
          </div>
        )}

        {activeTab === 'testcases' && (
          <div className="flex flex-col h-full">
            <div className="mb-2 flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider">
              Test Cases
              <InfoTooltip description={GUIDANCE.pm.testCases} label="i" />
            </div>
            <TestCaseEditor
              testCases={testCases}
              onAdd={onAddTestCase}
              onUpdate={onUpdateTestCase}
              onDelete={onDeleteTestCase}
            />
          </div>
        )}

        {activeTab === 'dependencies' && (
          <div className="flex flex-col h-full">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider">
                Dependencies
                <InfoTooltip description={GUIDANCE.pm.dependencies} label="i" />
              </div>
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
              dependencies={dependencies}
              availableItems={availableItems}
              currentItemId={ticket.id}
              onAdd={onAddDependency}
              onRemove={onRemoveDependency}
            />
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="working-directory"
                className="mb-1.5 flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
              >
                Working Directory
                <InfoTooltip description={GUIDANCE.pm.workingDirectory} label="i" />
              </label>
              <div className="flex gap-2">
                <input
                  id="working-directory"
                  data-testid="ticket-working-directory"
                  type="text"
                  value={ticket.workingDirectory || ''}
                  onChange={(e) => onUpdateTicket(ticket.id, { workingDirectory: e.target.value })}
                  placeholder="Inherit from project root"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const mod = await import('@tauri-apps/plugin-dialog');
                      const selected = await mod.open({ directory: true });
                      if (selected) {
                        onUpdateTicket(ticket.id, { workingDirectory: selected as string });
                      }
                    } catch (err) {
                      console.error('Failed to open directory dialog:', err);
                    }
                  }}
                  className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs text-foreground-muted hover:bg-white/10 hover:text-foreground transition-all flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">folder_open</span>
                  Browse
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-foreground-muted">
                If set, agents spawned from this ticket will start in this directory. Leave empty to
                use the default project root.
              </p>
            </div>

            <div>
              <label className="mb-1.5 flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider">
                Human Supervision
              </label>
              <button
                type="button"
                data-testid="human-supervision-toggle"
                onClick={() =>
                  onUpdateTicket(ticket.id, {
                    needsHumanSupervision: !ticket.needsHumanSupervision,
                  })
                }
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  ticket.needsHumanSupervision
                    ? 'bg-orange-500/10 border-orange-500/20 text-orange-300'
                    : 'bg-white/5 border-white/10 text-foreground-muted hover:bg-white/10'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {ticket.needsHumanSupervision ? 'visibility' : 'visibility_off'}
                </span>
                {ticket.needsHumanSupervision ? 'Enabled' : 'Disabled'}
              </button>
              <p className="mt-1.5 text-[10px] text-foreground-muted">
                {ticket.needsHumanSupervision
                  ? 'This ticket requires human supervision. It will be skipped by automatic task fetching — only a human can assign or start it.'
                  : 'Agents can automatically pick up this ticket. Enable to require manual assignment.'}
              </p>
            </div>
          </div>
        )}
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
