import { createTestStore as createFullTestStore } from '@/lib/store/testing';
import { beforeEach, describe, expect, it } from 'vitest';
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
  let store: ReturnType<typeof createFullTestStore>;

  beforeEach(() => {
    store = createFullTestStore();
  });

  describe('initial state', () => {
    it('starts with empty nodes and edges', () => {
      const state = store.getState();
      expect(state.ocNodes).toEqual([]);
      expect(state.ocEdges).toEqual([]);
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
