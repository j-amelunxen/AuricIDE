import type { StateCreator } from 'zustand';
import type {
  ObsidianCanvasData,
  ObsidianColor,
  ObsidianEdge,
  ObsidianNode,
} from '../obsidian-canvas/types';
import type { PmContextItem } from '../tauri/pm';

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
  ocSelectedNodeId: string | null;
  canvasContextMenu: CanvasContextMenu | null;
  canvasTicketCreate: CanvasTicketCreate | null;

  setObsidianCanvasData: (data: ObsidianCanvasData) => void;
  updateOcNode: (id: string, updates: Partial<ObsidianNode>) => void;
  addOcNode: (node: ObsidianNode) => void;
  removeOcNode: (id: string) => void;
  addOcEdge: (edge: ObsidianEdge) => void;
  removeOcEdge: (id: string) => void;
  selectOcNode: (id: string | null) => void;
  updateOcNodePosition: (id: string, x: number, y: number) => void;
  updateOcNodeSize: (id: string, width: number, height: number) => void;
  updateOcNodeColor: (id: string, color: ObsidianColor | undefined) => void;
  setCanvasContextMenu: (menu: CanvasContextMenu | null) => void;
  setCanvasTicketCreate: (data: CanvasTicketCreate | null) => void;
}

const patchNode =
  (id: string, updates: Partial<ObsidianNode>) =>
  (nodes: ObsidianNode[]): ObsidianNode[] =>
    nodes.map((node) => (node.id === id ? ({ ...node, ...updates } as ObsidianNode) : node));

const edgesWithoutNode =
  (nodeId: string) =>
  (edges: ObsidianEdge[]): ObsidianEdge[] =>
    edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId);

export const createObsidianCanvasSlice: StateCreator<ObsidianCanvasSlice> = (set) => ({
  ocNodes: [],
  ocEdges: [],
  ocSelectedNodeId: null,
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

  removeOcNode: (id) =>
    set((state) => ({
      ocNodes: state.ocNodes.filter((n) => n.id !== id),
      ocEdges: edgesWithoutNode(id)(state.ocEdges),
    })),

  addOcEdge: (edge) => set((state) => ({ ocEdges: [...state.ocEdges, edge] })),

  removeOcEdge: (id) => set((state) => ({ ocEdges: state.ocEdges.filter((e) => e.id !== id) })),

  selectOcNode: (id) => set({ ocSelectedNodeId: id }),

  updateOcNodePosition: (id, x, y) =>
    set((state) => ({ ocNodes: patchNode(id, { x, y })(state.ocNodes) })),

  updateOcNodeSize: (id, width, height) =>
    set((state) => ({ ocNodes: patchNode(id, { width, height })(state.ocNodes) })),

  updateOcNodeColor: (id, color) =>
    set((state) => ({ ocNodes: patchNode(id, { color })(state.ocNodes) })),

  setCanvasContextMenu: (menu) => set({ canvasContextMenu: menu }),

  setCanvasTicketCreate: (data) => set({ canvasTicketCreate: data }),
});
