import type { StateCreator } from 'zustand';
import type { WorkflowData, WorkflowEdge, WorkflowNode } from '../canvas/markdownParser';

export interface CanvasSlice {
  canvasNodes: WorkflowNode[];
  canvasEdges: WorkflowEdge[];
  selectedNodeId: string | null;
  addNode: (node: WorkflowNode) => void;
  updateNode: (id: string, updates: Partial<WorkflowNode>) => void;
  removeNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  setCanvasData: (data: WorkflowData) => void;
  onNodesChange: (changes: NodeChange[]) => void;
}

interface NodeChange {
  type: string;
  id: string;
  position?: { x: number; y: number };
}

export const createCanvasSlice: StateCreator<CanvasSlice> = (set) => ({
  canvasNodes: [],
  canvasEdges: [],
  selectedNodeId: null,

  addNode: (node) =>
    set((state) => ({
      canvasNodes: [...state.canvasNodes, node],
    })),

  updateNode: (id, updates) =>
    set((state) => ({
      canvasNodes: state.canvasNodes.map((node) =>
        node.id === id ? { ...node, ...updates } : node
      ),
    })),

  removeNode: (id) =>
    set((state) => ({
      canvasNodes: state.canvasNodes.filter((node) => node.id !== id),
      canvasEdges: state.canvasEdges.filter((edge) => edge.source !== id && edge.target !== id),
    })),

  selectNode: (id) => set({ selectedNodeId: id }),

  setCanvasData: (data) =>
    set({
      canvasNodes: data.nodes,
      canvasEdges: data.edges,
    }),

  onNodesChange: (changes) =>
    set((state) => {
      let nodes = [...state.canvasNodes];
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          nodes = nodes.map((node) =>
            node.id === change.id ? { ...node, position: change.position! } : node
          );
        }
      }
      return { canvasNodes: nodes };
    }),
});
