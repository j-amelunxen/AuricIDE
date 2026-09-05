import { ContextMenu, type ContextMenuOption } from './ContextMenu';
import { TicketCreateModal } from '../pm/TicketCreateModal';
import { OBSIDIAN_COLORS } from '@/lib/obsidian-canvas/canvasParser';
import type { ObsidianColor, ObsidianNode } from '@/lib/obsidian-canvas/types';
import type { useIDEState } from '@/lib/hooks/useIDEState';
import type { useIDEHandlers } from '@/lib/hooks/useIDEHandlers';

const CANVAS_COLOR_OPTIONS: { key: ObsidianColor; label: string }[] = [
  { key: '1', label: 'Red' },
  { key: '2', label: 'Orange' },
  { key: '3', label: 'Yellow' },
  { key: '4', label: 'Green' },
  { key: '5', label: 'Teal' },
  { key: '6', label: 'Purple' },
];

function buildCanvasContextMenuOptions(
  nodeId: string,
  nodes: ObsidianNode[],
  onColorChange: (nodeId: string, color: ObsidianColor | undefined) => void,
  onCreateTicket: (nodeId: string) => void
): ContextMenuOption[] {
  const node = nodes.find((n) => n.id === nodeId);
  const canCreateTicket = node && (node.type === 'text' || node.type === 'file');

  return [
    ...(canCreateTicket
      ? [
          {
            label: 'Create Ticket from Note',
            icon: 'confirmation_number',
            action: () => onCreateTicket(nodeId),
          },
          { type: 'separator' as const },
        ]
      : []),
    { type: 'header', label: 'Color' },
    ...CANVAS_COLOR_OPTIONS.map(({ key, label }) => ({
      label,
      icon: 'circle',
      iconColor: OBSIDIAN_COLORS[key],
      action: () => onColorChange(nodeId, key),
    })),
    { type: 'separator' },
    {
      label: 'Remove color',
      icon: 'format_color_reset',
      action: () => onColorChange(nodeId, undefined),
    },
  ];
}

interface CanvasPageModalsProps {
  state: ReturnType<typeof useIDEState>;
  handlers: ReturnType<typeof useIDEHandlers>;
}

export function CanvasPageModals({ state, handlers }: CanvasPageModalsProps) {
  return (
    <>
      {state.canvasContextMenu && (
        <ContextMenu
          x={state.canvasContextMenu.x}
          y={state.canvasContextMenu.y}
          options={buildCanvasContextMenuOptions(
            state.canvasContextMenu.nodeId,
            state.ocNodes,
            handlers.handleOcNodeColorChange,
            handlers.handleCreateTicketFromNode
          )}
          onClose={() => state.setCanvasContextMenu(null)}
        />
      )}
      {state.canvasTicketCreate && (
        <TicketCreateModal
          isOpen
          epics={state.pmDraftEpics}
          allTickets={state.pmDraftTickets}
          availableItems={[]}
          defaultEpicId={null}
          initialValues={state.canvasTicketCreate.initialValues}
          onSave={handlers.handleCanvasTicketSave}
          onSaveAndClose={(data, deps) => {
            handlers.handleCanvasTicketSave(data, deps);
            state.setCanvasTicketCreate(null);
          }}
          onClose={() => state.setCanvasTicketCreate(null)}
        />
      )}
      {state.fileTicketCreate && (
        <TicketCreateModal
          isOpen
          epics={state.pmDraftEpics}
          allTickets={state.pmDraftTickets}
          availableItems={[]}
          defaultEpicId={null}
          initialValues={state.fileTicketCreate.initialValues}
          onSave={handlers.handleFileTicketSave}
          onSaveAndClose={(data, deps) => {
            handlers.handleFileTicketSave(data, deps);
            state.setFileTicketCreate(null);
          }}
          onClose={() => state.setFileTicketCreate(null)}
        />
      )}
    </>
  );
}
