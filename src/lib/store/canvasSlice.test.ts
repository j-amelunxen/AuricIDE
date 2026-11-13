import { createTestStore as createFullTestStore } from '@/lib/store/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowNode } from '../canvas/markdownParser';

describe('canvasSlice', () => {
  let store: ReturnType<typeof createFullTestStore>;

  beforeEach(() => {
    store = createFullTestStore();
  });

  it('setCanvasData replaces all nodes and edges', () => {
    const node: WorkflowNode = {
      id: 'old',
      type: 'agent',
      title: 'Old',
      description: '',
      position: { x: 0, y: 0 },
    };
    store.setState({ canvasNodes: [node] });

    store.getState().setCanvasData({
      nodes: [
        {
          id: 'new-1',
          type: 'trigger',
          title: 'New 1',
          description: 'First new.',
          position: { x: 10, y: 20 },
        },
        {
          id: 'new-2',
          type: 'output',
          title: 'New 2',
          description: 'Second new.',
          position: { x: 30, y: 40 },
        },
      ],
      edges: [{ source: 'new-1', target: 'new-2' }],
    });

    expect(store.getState().canvasNodes).toHaveLength(2);
    expect(store.getState().canvasEdges).toHaveLength(1);
    expect(store.getState().canvasNodes[0].id).toBe('new-1');
  });

  it('onNodesChange applies position changes', () => {
    const node: WorkflowNode = {
      id: 'movable',
      type: 'agent',
      title: 'Movable',
      description: '',
      position: { x: 0, y: 0 },
    };
    store.setState({ canvasNodes: [node] });

    store.getState().onNodesChange([
      {
        type: 'position',
        id: 'movable',
        position: { x: 150, y: 250 },
      },
    ]);

    expect(store.getState().canvasNodes[0].position).toEqual({ x: 150, y: 250 });
  });
});
