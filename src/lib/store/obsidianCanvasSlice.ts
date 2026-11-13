import type { StoreState } from '@/lib/store/types';
import type { StateCreator } from 'zustand';
import type {
  ObsidianCanvasData,
  ObsidianColor,
  ObsidianEdge,
  ObsidianNode,
} from '../obsidian-canvas/types';
import type { PmContextItem } from '../pm/types';

export interface CanvasContextMenu {
  x: number;
  y: number;
  nodeId: string;
}

export interface CanvasTicketCreate {
  initialValues: { name: string; description: string; context: PmContextItem[] };
  nodeId: string;
}

export interface ObsidianCanvasSlice {
  ocNodes: ObsidianNode[];
  ocEdges: ObsidianEdge[];
  canvasContextMenu: CanvasContextMenu | null;
  canvasTicketCreate: CanvasTicketCreate | null;

  setObsidianCanvasData: (data: ObsidianCanvasData) => void;
  updateOcNode: (id: string, updates: Partial<ObsidianNode>) => void;
  addOcNode: (node: ObsidianNode) => void;
  updateOcNodeSize: (id: string, width: number, height: number) => void;
  updateOcNodeColor: (id: string, color: ObsidianColor | undefined) => void;
  setCanvasContextMenu: (menu: CanvasContextMenu | null) => void;
  setCanvasTicketCreate: (data: CanvasTicketCreate | null) => void;
}

const patchNode =
  (id: string, updates: Partial<ObsidianNode>) =>
  (nodes: ObsidianNode[]): ObsidianNode[] =>
    nodes.map((node) => (node.id === id ? ({ ...node, ...updates } as ObsidianNode) : node));

export const createObsidianCanvasSlice: StateCreator<StoreState, [], [], ObsidianCanvasSlice> = (
  set
) => ({
  ocNodes: [],
  ocEdges: [],
  canvasContextMenu: null,
  canvasTicketCreate: null,

  setObsidianCanvasData: (data) =>
    set({
      ocNodes: data.nodes,
      ocEdges: data.edges,
    }),

  updateOcNode: (id, updates) =>
    set((state) => ({ ocNodes: patchNode(id, updates)(state.ocNodes) })),

  addOcNode: (node) => set((state) => ({ ocNodes: [...state.ocNodes, node] })),

  updateOcNodeSize: (id, width, height) =>
    set((state) => ({ ocNodes: patchNode(id, { width, height })(state.ocNodes) })),

  updateOcNodeColor: (id, color) =>
    set((state) => ({ ocNodes: patchNode(id, { color })(state.ocNodes) })),

  setCanvasContextMenu: (menu) => set({ canvasContextMenu: menu }),

  setCanvasTicketCreate: (data) => set({ canvasTicketCreate: data }),
});
