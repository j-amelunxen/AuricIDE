import { beforeEach, describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createCanvasSlice, type CanvasSlice } from './canvasSlice';
import type { WorkflowNode } from '../canvas/markdownParser';

describe('canvasSlice', () => {
  let store: ReturnType<typeof createStore<CanvasSlice>>;

  beforeEach(() => {
    store = createStore<CanvasSlice>()(createCanvasSlice);
  });

  it('initializes with empty state', () => {
    const state = store.getState();
    expect(state.canvasNodes).toEqual([]);
    expect(state.canvasEdges).toEqual([]);
    expect(state.selectedNodeId).toBeNull();
  });

  it('addNode adds to canvasNodes', () => {
    const node: WorkflowNode = {
      id: 'test-node',
      type: 'agent',
      title: 'Test Node',
      description: 'A test node.',
      position: { x: 100, y: 200 },
    };

    store.getState().addNode(node);
    expect(store.getState().canvasNodes).toHaveLength(1);
    expect(store.getState().canvasNodes[0]).toEqual(node);
  });

  it('addNode appends to existing nodes', () => {
    const node1: WorkflowNode = {
      id: 'node-1',
      type: 'trigger',
      title: 'Node 1',
      description: 'First.',
      position: { x: 0, y: 0 },
    };
    const node2: WorkflowNode = {
      id: 'node-2',
      type: 'output',
      title: 'Node 2',
      description: 'Second.',
      position: { x: 100, y: 0 },
    };

    store.getState().addNode(node1);
    store.getState().addNode(node2);
    expect(store.getState().canvasNodes).toHaveLength(2);
  });

  it('updateNode modifies an existing node', () => {
    const node: WorkflowNode = {
      id: 'update-me',
      type: 'agent',
      title: 'Original',
      description: 'Original desc.',
      position: { x: 50, y: 50 },
    };

    store.getState().addNode(node);
    store.getState().updateNode('update-me', { title: 'Updated', position: { x: 200, y: 300 } });

    const updated = store.getState().canvasNodes[0];
    expect(updated.title).toBe('Updated');
    expect(updated.position).toEqual({ x: 200, y: 300 });
    expect(updated.description).toBe('Original desc.');
  });

  it('updateNode does nothing for non-existent node', () => {
    store.getState().updateNode('nonexistent', { title: 'Nope' });
    expect(store.getState().canvasNodes).toEqual([]);
  });

  it('removeNode removes the node from canvasNodes', () => {
    const node: WorkflowNode = {
      id: 'remove-me',
      type: 'script',
      title: 'Remove Me',
      description: 'To be removed.',
      position: { x: 0, y: 0 },
    };

    store.getState().addNode(node);
    expect(store.getState().canvasNodes).toHaveLength(1);

    store.getState().removeNode('remove-me');
    expect(store.getState().canvasNodes).toHaveLength(0);
  });

  it('removeNode cleans up related edges', () => {
    const nodeA: WorkflowNode = {
      id: 'a',
      type: 'trigger',
      title: 'A',
      description: '',
      position: { x: 0, y: 0 },
    };
    const nodeB: WorkflowNode = {
      id: 'b',
      type: 'agent',
      title: 'B',
      description: '',
      position: { x: 100, y: 0 },
    };

    store.getState().addNode(nodeA);
    store.getState().addNode(nodeB);
    store.getState().setCanvasData({
      nodes: [nodeA, nodeB],
      edges: [{ source: 'a', target: 'b' }],
    });

    store.getState().removeNode('a');
    expect(store.getState().canvasEdges).toHaveLength(0);
  });

  it('selectNode sets selectedNodeId', () => {
    store.getState().selectNode('some-node');
    expect(store.getState().selectedNodeId).toBe('some-node');
  });

  it('selectNode with null clears selection', () => {
    store.getState().selectNode('some-node');
    store.getState().selectNode(null);
    expect(store.getState().selectedNodeId).toBeNull();
  });

  it('setCanvasData replaces all nodes and edges', () => {
    const node: WorkflowNode = {
      id: 'old',
      type: 'agent',
      title: 'Old',
      description: '',
      position: { x: 0, y: 0 },
    };
    store.getState().addNode(node);

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
    store.getState().addNode(node);

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
