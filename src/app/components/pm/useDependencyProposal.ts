import { useState } from 'react';
import type { useLLM } from '@/lib/hooks/useLLM';
import {
  generateDependencyProposalPrompt,
  parseDependencyResponse,
} from '@/lib/pm/dependencyProposal';
import type { PmDependency, PmEpic, PmTicket } from '@/lib/pm/types';

type Llm = Pick<ReturnType<typeof useLLM>, 'call' | 'abort' | 'isLoading'>;

/**
 * "Propose dependencies" for one ticket: asks the model which tickets of the
 * same epic it waits on, lets the person tick suggestions, and turns the ticked
 * ones into dependencies the caller adds. The create dialog and the edit panel
 * both run it; only where the accepted dependencies go differs.
 */
export function useDependencyProposal(llm: Llm) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string; reason: string }[]>(
    []
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const propose = async (ticket: PmTicket, epic: PmEpic, allTickets: PmTicket[]) => {
    setIsOpen(true);
    setSuggestions([]);
    setSelectedIds([]);
    const epicTickets = allTickets.filter((t) => t.epicId === epic.id);
    const response = await llm.call([
      { role: 'user', content: generateDependencyProposalPrompt(ticket, epic, epicTickets) },
    ]);
    if (!response) return;
    const named = parseDependencyResponse(response)
      .map((s) => ({ ...s, name: allTickets.find((t) => t.id === s.id)?.name || 'Unknown' }))
      .filter((s) => s.id !== ticket.id);
    setSuggestions(named);
    setSelectedIds(named.map((s) => s.id));
  };

  /** Closes the proposal and returns the ticked tickets as dependencies not already in `existing`. */
  const accept = (ticketId: string, existing: readonly PmDependency[]): PmDependency[] => {
    setIsOpen(false);
    return selectedIds
      .filter((id) => !existing.some((d) => d.targetId === id))
      .map((id) => ({
        id: crypto.randomUUID(),
        sourceType: 'ticket' as const,
        sourceId: ticketId,
        targetType: 'ticket' as const,
        targetId: id,
      }));
  };

  /** Props for `DependencyProposalModal`, everything but `onConfirm`. */
  const modal = {
    isOpen,
    onClose: () => {
      setIsOpen(false);
      llm.abort();
    },
    suggestions,
    selectedIds,
    onToggleSuggestion: (id: string) =>
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id])),
    isLoading: llm.isLoading,
  };

  return { propose, accept, modal };
}
