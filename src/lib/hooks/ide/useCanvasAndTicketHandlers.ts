'use client';

import { useCallback } from 'react';
import { useStore } from '@/lib/store';
import { writeFile, readFile } from '@/lib/tauri/fs';
import { serializeMindmap, type MindmapNode } from '@/lib/mindmap/mindmapParser';
import { type WorkflowNode, serializeWorkflow } from '@/lib/canvas/markdownParser';
import { serializeObsidianCanvas } from '@/lib/obsidian-canvas/canvasParser';
import type { ObsidianNode, ObsidianEdge, ObsidianColor } from '@/lib/obsidian-canvas/types';
import type { PmTicket, PmDependency } from '@/lib/tauri/pm';
import { persistInBackground } from '@/lib/store/persistFeedback';
import { type FileTreeNode } from '@/app/components/explorer/FileExplorer';
import type { useIDEState } from '../useIDEState';

export function useCanvasAndTicketHandlers(
  state: ReturnType<typeof useIDEState>,
  handleFileSelect: (path: string) => Promise<void>
) {
  const handleCanvasNodesChange = useCallback(
    (nodes: WorkflowNode[]) => {
      state.setCanvasData({ nodes, edges: state.canvasEdges });
      if (state.activeTabId) {
        const updated = serializeWorkflow({ nodes, edges: state.canvasEdges });
        writeFile(state.activeTabId, updated);
      }
    },
    [state]
  );

  const handleMindmapNodesChange = useCallback(
    (nodes: unknown[]) => {
      if (state.mindmapData) {
        const newData = { ...state.mindmapData, nodes: nodes as unknown as MindmapNode[] };
        state.setMindmapData(newData);
        if (state.activeTabId) {
          writeFile(state.activeTabId, serializeMindmap(newData));
        }
      }
    },
    [state]
  );

  const handleMindmapNodeEdit = useCallback(
    (id: string, text: string) => {
      if (state.mindmapData) {
        const nodes = state.mindmapData.nodes.map((n) =>
          n.id === id ? { ...n, content: text } : n
        );
        handleMindmapNodesChange(nodes);
      }
    },
    [state, handleMindmapNodesChange]
  );

  const handleOcNodesChange = useCallback((nodes: ObsidianNode[]) => {
    const { ocEdges, activeTabId, setObsidianCanvasData } = useStore.getState();
    setObsidianCanvasData({ nodes, edges: ocEdges });
    if (activeTabId) {
      writeFile(activeTabId, serializeObsidianCanvas({ nodes, edges: ocEdges }));
    }
  }, []);

  const handleOcEdgesChange = useCallback((edges: ObsidianEdge[]) => {
    const { ocNodes, activeTabId, setObsidianCanvasData } = useStore.getState();
    setObsidianCanvasData({ nodes: ocNodes, edges });
    if (activeTabId) {
      writeFile(activeTabId, serializeObsidianCanvas({ nodes: ocNodes, edges }));
    }
  }, []);

  const handleOcTextEdit = useCallback((id: string, newText: string) => {
    const { ocNodes, ocEdges, activeTabId, setObsidianCanvasData } = useStore.getState();
    const updatedNodes = ocNodes.map((n) =>
      n.id === id && n.type === 'text' ? { ...n, text: newText } : n
    );
    setObsidianCanvasData({ nodes: updatedNodes, edges: ocEdges });
    if (activeTabId) {
      writeFile(activeTabId, serializeObsidianCanvas({ nodes: updatedNodes, edges: ocEdges }));
    }
  }, []);

  const handleOcFileOpen = useCallback(
    (relativePath: string) => {
      if (!state.rootPath) return;
      handleFileSelect(`${state.rootPath}/${relativePath}`);
    },
    [state.rootPath, handleFileSelect]
  );

  const handleOcFileDrop = useCallback(
    (absolutePath: string, position: { x: number; y: number }) => {
      const { rootPath, ocNodes, ocEdges, activeTabId, setObsidianCanvasData } =
        useStore.getState();
      const relativePath = rootPath
        ? absolutePath.replace(rootPath.replace(/\/$/, '') + '/', '')
        : absolutePath;
      const newNode: ObsidianNode = {
        id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'file' as const,
        file: relativePath,
        x: position.x,
        y: position.y,
        width: 400,
        height: 300,
      };
      const updatedNodes = [...ocNodes, newNode];
      setObsidianCanvasData({ nodes: updatedNodes, edges: ocEdges });
      if (activeTabId) {
        writeFile(activeTabId, serializeObsidianCanvas({ nodes: updatedNodes, edges: ocEdges }));
      }
    },
    []
  );

  const handleOcResize = useCallback((id: string, width: number, height: number) => {
    const { ocNodes, ocEdges, activeTabId, setObsidianCanvasData } = useStore.getState();
    const updatedNodes = ocNodes.map((n) => (n.id === id ? { ...n, width, height } : n));
    setObsidianCanvasData({ nodes: updatedNodes, edges: ocEdges });
    if (activeTabId) {
      writeFile(activeTabId, serializeObsidianCanvas({ nodes: updatedNodes, edges: ocEdges }));
    }
  }, []);

  const handleOcNodeContextMenu = useCallback((event: React.MouseEvent, node: { id: string }) => {
    event.preventDefault();
    useStore
      .getState()
      .setCanvasContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);

  const handleOcNodeColorChange = useCallback(
    (nodeId: string, color: ObsidianColor | undefined) => {
      const { ocNodes, ocEdges, activeTabId, setObsidianCanvasData, setCanvasContextMenu } =
        useStore.getState();
      const updatedNodes = ocNodes.map((n) => (n.id === nodeId ? { ...n, color } : n));
      setObsidianCanvasData({ nodes: updatedNodes, edges: ocEdges });
      if (activeTabId) {
        writeFile(activeTabId, serializeObsidianCanvas({ nodes: updatedNodes, edges: ocEdges }));
      }
      setCanvasContextMenu(null);
    },
    []
  );

  const handleCreateTicketFromNode = useCallback((nodeId: string) => {
    const store = useStore.getState();
    const node = store.ocNodes.find((n) => n.id === nodeId);
    if (!node || (node.type !== 'text' && node.type !== 'file')) return;

    store.setCanvasContextMenu(null);

    let name = '';
    let description = '';
    if (node.type === 'text') {
      const lines = node.text.split('\n');
      name = lines[0]?.replace(/^#+\s*/, '').trim() ?? '';
      description = lines.slice(1).join('\n').trim();
    } else if (node.type === 'file') {
      name =
        node.file
          .split('/')
          .pop()
          ?.replace(/\.\w+$/, '') ?? '';
      description = `From canvas file node: ${node.file}`;
    }

    const canvasRelPath =
      store.activeTabId && store.rootPath
        ? store.activeTabId.replace(store.rootPath.replace(/\/$/, '') + '/', '')
        : (store.activeTabId ?? '');

    store.setCanvasTicketCreate({
      nodeId,
      initialValues: {
        name,
        description,
        context: [
          { id: crypto.randomUUID(), type: 'canvas-node', value: `${canvasRelPath}#${nodeId}` },
          { id: crypto.randomUUID(), type: 'file', value: canvasRelPath },
        ],
      },
    });
  }, []);

  const persistNewTicket = useCallback(
    (
      ticketData: Omit<PmTicket, 'createdAt' | 'updatedAt' | 'statusUpdatedAt' | 'sortOrder'>,
      dependencies: PmDependency[]
    ) => {
      const now = new Date().toISOString();
      const store = useStore.getState();

      store.addTicket({
        ...ticketData,
        statusUpdatedAt: now,
        sortOrder: store.pmDraftTickets.length,
        createdAt: now,
        updatedAt: now,
      });
      dependencies.forEach((dep) => store.addDependency(dep));

      if (store.rootPath) persistInBackground(store.savePmData(store.rootPath));
    },
    []
  );

  const handleCanvasTicketSave = useCallback(
    (
      ticketData: Omit<PmTicket, 'createdAt' | 'updatedAt' | 'statusUpdatedAt' | 'sortOrder'>,
      dependencies: PmDependency[]
    ) => {
      persistNewTicket(ticketData, dependencies);

      const store = useStore.getState();
      const { canvasTicketCreate, activeTabId } = store;
      if (canvasTicketCreate?.nodeId) {
        const updatedNodes = store.ocNodes.map((n) =>
          n.id === canvasTicketCreate.nodeId ? { ...n, auricTicketId: ticketData.id } : n
        );
        store.setObsidianCanvasData({ nodes: updatedNodes, edges: store.ocEdges });
        if (activeTabId) {
          writeFile(
            activeTabId,
            serializeObsidianCanvas({ nodes: updatedNodes, edges: store.ocEdges })
          );
        }
      }
    },
    [persistNewTicket]
  );

  const handleFileTicketSave = useCallback(
    (
      ticketData: Omit<PmTicket, 'createdAt' | 'updatedAt' | 'statusUpdatedAt' | 'sortOrder'>,
      dependencies: PmDependency[]
    ) => {
      persistNewTicket(ticketData, dependencies);
    },
    [persistNewTicket]
  );

  const handleCreateTicketFromMarkdown = useCallback(
    async (node: FileTreeNode) => {
      const content = await readFile(node.path);
      const firstHeading = content.match(/^#+\s*(.+)$/m)?.[1]?.trim();
      const fallbackName = node.name.replace(/\.(md|markdown)$/i, '');
      state.setFileTicketCreate({
        initialValues: {
          name: firstHeading || fallbackName,
          description: content,
          context: [{ id: crypto.randomUUID(), type: 'file', value: node.path }],
        },
      });
    },
    [state]
  );

  const handleTicketBadgeClick = useCallback((ticketId: string) => {
    const store = useStore.getState();
    const ticket = store.pmDraftTickets.find((t) => t.id === ticketId);
    if (!ticket) return;

    store.setPmSelectedEpicId(ticket.epicId);
    store.setPmSelectedTicketId(ticket.id);
    store.openWorkPlace('tickets');
  }, []);

  return {
    handleCanvasNodesChange,
    handleMindmapNodesChange,
    handleMindmapNodeEdit,
    handleOcNodesChange,
    handleOcEdgesChange,
    handleOcTextEdit,
    handleOcResize,
    handleOcFileOpen,
    handleOcFileDrop,
    handleOcNodeContextMenu,
    handleOcNodeColorChange,
    handleCreateTicketFromNode,
    handleCanvasTicketSave,
    handleFileTicketSave,
    handleCreateTicketFromMarkdown,
    handleTicketBadgeClick,
  };
}
