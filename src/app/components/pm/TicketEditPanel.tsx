'use client';

import { useState } from 'react';
import { TestCaseEditor } from './TestCaseEditor';
import { DependencySelector } from './DependencySelector';
import { TicketContextEditor } from './TicketContextEditor';
import { useStore } from '@/lib/store';
import { isClosedTicketStatus } from '@/lib/pm/enums';
import { generateTicketPrompt } from '@/lib/pm/prompt';
import { InfoTooltip } from '../ui/InfoTooltip';
import { AuricIcon } from '../ui/AuricIcon';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { useLLM } from '@/lib/hooks/useLLM';
import {
  generateDependencyProposalPrompt,
  parseDependencyResponse,
} from '@/lib/pm/dependencyProposal';
import {
  generateTestCaseDerivationPrompt,
  parseTestCaseResponse,
} from '@/lib/pm/testCaseDerivation';
import { DependencyProposalModal } from './DependencyProposalModal';
import { useProjectSkills } from '@/lib/hooks/useProjectSkills';
import { copyToClipboard } from '@/lib/tauri/clipboard';
import type { DetailTab, TicketEditPanelProps } from './ticketEdit/types';
import { TicketEditToolbar } from './ticketEdit/TicketEditToolbar';
import { TicketDetailsTab } from './ticketEdit/TicketDetailsTab';
import { TicketAdvancedTab } from './ticketEdit/TicketAdvancedTab';

export type { TicketEditPanelProps };

export function TicketEditPanel({
  ticket,
  epics,
  allTickets,
  testCases,
  dependencies,
  availableItems,
  onUpdateTicket,
  onSave,
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

  const { call: llmCall, abort: llmAbort, isLoading: isLlmLoading } = useLLM();
  const { discovered } = useProjectSkills();
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

  const handleDeriveTestCases = async () => {
    const prompt = generateTestCaseDerivationPrompt(ticket);
    const response = await llmCall([{ role: 'user', content: prompt }]);
    if (response) {
      const derived = parseTestCaseResponse(response);
      derived.forEach((tc) => {
        onAddTestCase(tc);
      });
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
    return item && item.type === 'ticket' && !isClosedTicketStatus(item.status ?? '');
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
    const ok = await copyToClipboard(prompt);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const tabs: { key: DetailTab; label: string; count?: number }[] = [
    { key: 'details', label: 'Details' },
    { key: 'context', label: 'Context', count: ticket.context?.length || 0 },
    { key: 'testcases', label: 'Test Cases', count: testCases.length },
    { key: 'dependencies', label: 'Dependencies', count: dependencies.length },
    { key: 'advanced', label: 'Advanced Settings' },
  ];

  return (
    <div className="flex h-full flex-col">
      {isBlocked && (
        <div className="flex items-center gap-2 bg-git-deleted/10 px-4 py-2 border-b border-git-deleted/20">
          <AuricIcon name="warning" className="text-[16px] text-git-deleted" />
          <span className="text-[11px] font-medium text-git-deleted">
            This ticket is blocked by unfinished dependencies.
          </span>
        </div>
      )}

      <TicketEditToolbar
        ticket={ticket}
        epics={epics}
        pmDirty={pmDirty}
        copied={copied}
        onUpdateTicket={onUpdateTicket}
        onMoveTicket={onMoveTicket}
        onCancel={onCancel}
        onSave={onSave}
        onDeleteTicket={onDeleteTicket}
        onSpawnAgent={handleSpawnAgent}
        onCopyPrompt={handleCopyPrompt}
      />

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
          <TicketDetailsTab
            ticket={ticket}
            discovered={discovered}
            onUpdateTicket={onUpdateTicket}
          />
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
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider">
                Test Cases
                <InfoTooltip description={GUIDANCE.pm.testCases} label="i" />
              </div>
              <button
                type="button"
                onClick={handleDeriveTestCases}
                disabled={isLlmLoading}
                className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1.5 text-[10px] font-bold text-primary-light transition hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <AuricIcon name="psychology" className="text-[14px]" />
                Derive Test Cases
              </button>
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
                disabled={isLlmLoading}
                className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1.5 text-[10px] font-bold text-primary-light transition hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <AuricIcon name="lightbulb" className="text-[14px]" />
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
          <TicketAdvancedTab ticket={ticket} onUpdateTicket={onUpdateTicket} />
        )}
      </div>

      <DependencyProposalModal
        isOpen={proposalModalOpen}
        onClose={() => {
          setProposalModalOpen(false);
          llmAbort();
        }}
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
