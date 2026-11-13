import type { StoreState } from '@/lib/store/types';
import type { StateCreator } from 'zustand';
import type { WorkflowData, WorkflowEdge, WorkflowNode } from '../canvas/markdownParser';

export interface CanvasSlice {
  canvasNodes: WorkflowNode[];
  canvasEdges: WorkflowEdge[];
  setCanvasData: (data: WorkflowData) => void;
  onNodesChange: (changes: NodeChange[]) => void;
}

interface NodeChange {
  type: string;
  id: string;
  position?: { x: number; y: number };
}

export const createCanvasSlice: StateCreator<StoreState, [], [], CanvasSlice> = (set) => ({
  canvasNodes: [],
  canvasEdges: [],

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
