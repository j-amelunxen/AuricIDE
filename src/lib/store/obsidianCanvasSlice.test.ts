import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createObsidianCanvasSlice, type ObsidianCanvasSlice } from './obsidianCanvasSlice';
import type {
  ObsidianCanvasData,
  ObsidianEdge,
  ObsidianTextNode,
  ObsidianFileNode,
} from '../obsidian-canvas/types';

const textNode = (id: string, overrides?: Partial<ObsidianTextNode>): ObsidianTextNode => ({
  id,
  type: 'text',
  text: `Content of ${id}`,
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  ...overrides,
});

const fileNode = (id: string, overrides?: Partial<ObsidianFileNode>): ObsidianFileNode => ({
  id,
  type: 'file',
  file: `notes/${id}.md`,
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  ...overrides,
});

const edge = (id: string, fromNode: string, toNode: string): ObsidianEdge => ({
  id,
  fromNode,
  toNode,
});

describe('obsidianCanvasSlice', () => {
  let store: StoreApi<ObsidianCanvasSlice>;

  beforeEach(() => {
    store = createStore<ObsidianCanvasSlice>()(createObsidianCanvasSlice);
  });

  describe('initial state', () => {
    it('starts with empty nodes and edges', () => {
      const state = store.getState();
      expect(state.ocNodes).toEqual([]);
      expect(state.ocEdges).toEqual([]);
    });

    it('starts with no selected node', () => {
      expect(store.getState().ocSelectedNodeId).toBeNull();
    });
  });

  describe('setObsidianCanvasData', () => {
    it('replaces nodes and edges with new data', () => {
      const data: ObsidianCanvasData = {
        nodes: [textNode('n1'), fileNode('n2')],
        edges: [edge('e1', 'n1', 'n2')],
      };

      store.getState().setObsidianCanvasData(data);

      expect(store.getState().ocNodes).toHaveLength(2);
      expect(store.getState().ocEdges).toHaveLength(1);
      expect(store.getState().ocNodes[0].id).toBe('n1');
    });

    it('replaces previously loaded data entirely', () => {
      store.getState().setObsidianCanvasData({
        nodes: [textNode('old')],
        edges: [],
      });

      store.getState().setObsidianCanvasData({
        nodes: [textNode('new1'), textNode('new2')],
        edges: [edge('e1', 'new1', 'new2')],
      });

      expect(store.getState().ocNodes).toHaveLength(2);
      expect(store.getState().ocNodes[0].id).toBe('new1');
      expect(store.getState().ocEdges).toHaveLength(1);
    });
  });

  describe('updateOcNode', () => {
    it('updates fields of the target node', () => {
      store.getState().addOcNode(textNode('n1'));

      store.getState().updateOcNode('n1', { x: 50, y: 75 });

      const updated = store.getState().ocNodes[0];
      expect(updated.x).toBe(50);
      expect(updated.y).toBe(75);
    });

    it('leaves other nodes unchanged', () => {
      store.getState().addOcNode(textNode('n1'));
      store.getState().addOcNode(textNode('n2'));

      store.getState().updateOcNode('n1', { x: 999 });

      expect(store.getState().ocNodes[1].x).toBe(0);
    });

    it('does nothing for a non-existent id', () => {
      store.getState().addOcNode(textNode('n1'));

      store.getState().updateOcNode('does-not-exist', { x: 500 });

      expect(store.getState().ocNodes[0].x).toBe(0);
    });
  });

  describe('addOcNode', () => {
    it('appends a node to the list', () => {
      store.getState().addOcNode(textNode('n1'));

      expect(store.getState().ocNodes).toHaveLength(1);
      expect(store.getState().ocNodes[0].id).toBe('n1');
    });

    it('appends multiple nodes in order', () => {
      store.getState().addOcNode(textNode('n1'));
      store.getState().addOcNode(fileNode('n2'));

      expect(store.getState().ocNodes).toHaveLength(2);
      expect(store.getState().ocNodes[1].id).toBe('n2');
    });
  });

  describe('removeOcNode', () => {
    it('removes the node with the given id', () => {
      store.getState().addOcNode(textNode('n1'));
      store.getState().addOcNode(textNode('n2'));

      store.getState().removeOcNode('n1');

      expect(store.getState().ocNodes).toHaveLength(1);
      expect(store.getState().ocNodes[0].id).toBe('n2');
    });

    it('removes edges where the node is the source', () => {
      store.getState().setObsidianCanvasData({
        nodes: [textNode('a'), textNode('b'), textNode('c')],
        edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
      });

      store.getState().removeOcNode('a');

      expect(store.getState().ocEdges).toHaveLength(1);
      expect(store.getState().ocEdges[0].id).toBe('e2');
    });

    it('removes edges where the node is the target', () => {
      store.getState().setObsidianCanvasData({
        nodes: [textNode('a'), textNode('b'), textNode('c')],
        edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
      });

      store.getState().removeOcNode('b');

      expect(store.getState().ocEdges).toHaveLength(0);
    });
  });

  describe('addOcEdge', () => {
    it('appends an edge to the list', () => {
      store.getState().addOcEdge(edge('e1', 'n1', 'n2'));

      expect(store.getState().ocEdges).toHaveLength(1);
      expect(store.getState().ocEdges[0].id).toBe('e1');
    });

    it('appends multiple edges in order', () => {
      store.getState().addOcEdge(edge('e1', 'n1', 'n2'));
      store.getState().addOcEdge(edge('e2', 'n2', 'n3'));

      expect(store.getState().ocEdges).toHaveLength(2);
      expect(store.getState().ocEdges[1].id).toBe('e2');
    });
  });

  describe('removeOcEdge', () => {
    it('removes the edge with the given id', () => {
      store.getState().addOcEdge(edge('e1', 'n1', 'n2'));
      store.getState().addOcEdge(edge('e2', 'n2', 'n3'));

      store.getState().removeOcEdge('e1');

      expect(store.getState().ocEdges).toHaveLength(1);
      expect(store.getState().ocEdges[0].id).toBe('e2');
    });

    it('does nothing for a non-existent edge id', () => {
      store.getState().addOcEdge(edge('e1', 'n1', 'n2'));

      store.getState().removeOcEdge('does-not-exist');

      expect(store.getState().ocEdges).toHaveLength(1);
    });
  });

  describe('selectOcNode', () => {
    it('sets the selected node id', () => {
      store.getState().selectOcNode('n1');

      expect(store.getState().ocSelectedNodeId).toBe('n1');
    });

    it('clears the selection when called with null', () => {
      store.getState().selectOcNode('n1');
      store.getState().selectOcNode(null);

      expect(store.getState().ocSelectedNodeId).toBeNull();
    });

    it('updates selection when switching between nodes', () => {
      store.getState().selectOcNode('n1');
      store.getState().selectOcNode('n2');

      expect(store.getState().ocSelectedNodeId).toBe('n2');
    });
  });

  describe('updateOcNodePosition', () => {
    it('updates x and y for the target node', () => {
      store.getState().addOcNode(textNode('n1'));

      store.getState().updateOcNodePosition('n1', 400, 300);

      const node = store.getState().ocNodes[0];
      expect(node.x).toBe(400);
      expect(node.y).toBe(300);
    });

    it('does not affect other properties', () => {
      store.getState().addOcNode(textNode('n1'));

      store.getState().updateOcNodePosition('n1', 400, 300);

      const node = store.getState().ocNodes[0];
      expect(node.width).toBe(200);
      expect(node.height).toBe(100);
    });

    it('leaves other nodes at their original positions', () => {
      store.getState().addOcNode(textNode('n1', { x: 10, y: 20 }));
      store.getState().addOcNode(textNode('n2', { x: 50, y: 60 }));

      store.getState().updateOcNodePosition('n1', 400, 300);

      expect(store.getState().ocNodes[1].x).toBe(50);
      expect(store.getState().ocNodes[1].y).toBe(60);
    });
  });

  describe('updateOcNodeSize', () => {
    it('updates width and height for the target node', () => {
      store.getState().addOcNode(textNode('n1'));

      store.getState().updateOcNodeSize('n1', 800, 600);

      const node = store.getState().ocNodes[0];
      expect(node.width).toBe(800);
      expect(node.height).toBe(600);
    });

    it('does not affect position or other fields', () => {
      store.getState().addOcNode(textNode('n1', { x: 42, y: 84 }));

      store.getState().updateOcNodeSize('n1', 800, 600);

      const node = store.getState().ocNodes[0];
      expect(node.x).toBe(42);
      expect(node.y).toBe(84);
    });
  });

  describe('updateOcNodeColor', () => {
    it('sets the color of the target node', () => {
      store.getState().addOcNode(textNode('n1'));

      store.getState().updateOcNodeColor('n1', '3');

      expect(store.getState().ocNodes[0].color).toBe('3');
    });

    it('removes the color when called with undefined', () => {
      store.getState().addOcNode(textNode('n1', { color: '2' }));

      store.getState().updateOcNodeColor('n1', undefined);

      expect(store.getState().ocNodes[0].color).toBeUndefined();
    });

    it('leaves other nodes colors unchanged', () => {
      store.getState().addOcNode(textNode('n1', { color: '1' }));
      store.getState().addOcNode(textNode('n2', { color: '4' }));

      store.getState().updateOcNodeColor('n1', '6');

      expect(store.getState().ocNodes[1].color).toBe('4');
    });
  });
});
